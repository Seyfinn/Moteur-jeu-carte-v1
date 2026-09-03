import type { CharacterCardDef, EffectContext } from '../types.js';
import type { CharacterInstance, GameState, PlayerId } from '../../types.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { getCharacterCard } from '../registry.js';

const BANG_BASE_ATK = 40;
const BANG_BONUS_PER_SEAL = 30;

/**
 * Le sceau posé par "Sacrifice". Porté par l'allié sacrifié, jamais par Makima : c'est lui
 * qui perd l'usage de la compétence, et c'est sa mort qui doit faire disparaître le sceau
 * (donc le bonus de Bang !). `data.sealedIds` accumule les ids scellés sur ce personnage --
 * un même allié peut être sacrifié plusieurs fois, une compétence à la fois.
 *
 * Statut privé à la carte, donc jamais déplacé par un effet « échange tous les statuts »
 * (cf. BUILTIN_STATUS_IDS) : posé sur une carte qui ne sait pas le lire, il ne voudrait rien
 * dire, et le sceau doit rester là où la compétence scellée se trouve.
 */
const SEAL_STATUS_ID = 'makima-sceau';

/** Marque interne : la manipulation est armée, la cible attend le tour d'en face. */
const MANIPULATION_MARK_STATUS_ID = 'makima-manipulation-armee';
const MANIPULATION_COOLDOWN_STATUS_ID = 'makima-manipulation-recharge';
const MANIPULATION_SEALS_REQUIRED = 2;
/** « Pas utilisable 2 tours de suite » : utilisée au tour N, elle saute N+1 et revient à N+2.
 *  Statut bloquant posé sur Makima pendant son propre tour, donc +1 (cf. CLAUDE.md). */
const MANIPULATION_COOLDOWN_REMAINING_TURNS = 1 + 1;
/** Posé sur l'actif adverse pendant le tour de Makima : il doit encore être là au tour
 *  suivant, celui d'en face, pour que le moteur le résolve avant que le joueur n'agisse. */
const FORCED_ATTACK_REMAINING_TURNS = 2;

/** Les ids (compétences + attaques) scellés sur ce personnage. */
function sealedIdsOf(char: CharacterInstance): string[] {
  const seal = getStatus(char, SEAL_STATUS_ID);
  const ids = seal?.data?.['sealedIds'];
  return Array.isArray(ids) ? (ids as string[]) : [];
}

/**
 * Le nombre total de sceaux encore debout dans le camp de Makima. Un allié parti au
 * cimetière emporte ses sceaux avec lui : la compétence n'est plus scellée, elle n'existe
 * plus, et Bang ! redescend d'autant.
 */
function countSeals(state: GameState, ownerId: PlayerId): number {
  const player = state.players[ownerId];
  const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
    (id): id is string => id !== null
  );
  let total = 0;
  for (const id of ids) {
    const char = player.characters[id];
    if (char) total += sealedIdsOf(char).length;
  }
  return total;
}

/** Toutes les compétences et attaques d'un allié, scellées ou non. */
function allEntries(char: CharacterInstance): { key: string; label: string }[] {
  const def = getCharacterCard(char.cardId);
  const entries: { key: string; label: string }[] = [];
  for (const ability of def.abilities) {
    entries.push({ key: ability.id, label: `${ability.name} (${ability.kind === 'active' ? 'Actif' : 'Passif'})` });
  }
  for (const attack of def.attacks) {
    entries.push({ key: attack.id, label: `${attack.name} (ATK)` });
  }
  return entries;
}

/** Ce qui reste à sceller chez un allié : ses compétences et ses attaques pas encore prises. */
function sealableEntries(char: CharacterInstance): { key: string; label: string }[] {
  const already = new Set(sealedIdsOf(char));
  return allEntries(char).filter((e) => !already.has(e.key));
}

/**
 * Le libellé du statut affiché sur la carte : la liste des noms scellés, pas juste un
 * compteur -- sinon le badge ne dit pas CE QUI est désactivé (bug rapporté par l'utilisateur).
 */
function sealedStatusLabel(char: CharacterInstance, sealedIds: string[]): string {
  const byKey = new Map(allEntries(char).map((e) => [e.key, e.label]));
  const names = sealedIds.map((id) => byKey.get(id) ?? id);
  return `Scellé par Makima : ${names.join(', ')}`;
}

/** Les alliés du banc qui ont encore quelque chose à sacrifier. */
function sacrificeCandidates(ctx: EffectContext): CharacterInstance[] {
  return ctx.getBench(ctx.ownerId).filter((c) => sealableEntries(c).length > 0);
}

export const makima: CharacterCardDef = {
  type: 'character',
  id: 'makima',
  name: 'Makima',
  baseMaxHP: 190,
  attacks: [
    {
      id: 'bang',
      name: 'Bang !',
      baseATK: BANG_BASE_ATK,
      description: 'Inflige 30 dégâts de plus par compétence alliée scellé (sacrifice)',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // Le bonus par sceau passe par le modifier getEffectiveATK plus bas, pas par une
        // addition ici : les buffs et malus d'ATK s'appliquent ainsi au total, comme pour Guts.
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BANG_BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'sacrifice',
      name: 'Sacrifice',
      kind: 'active',
      description:
        "Au début du tour, Makima peut choisir de sceller (désactiver) de manière permanente, au choix 1 Passif, 1 Actif ou 1 ATK d'un personnage sur son propre banc.",
      condition(ctx) {
        return sacrificeCandidates(ctx).length > 0;
      },
      async execute(ctx) {
        const candidates = sacrificeCandidates(ctx);
        if (candidates.length === 0) return;

        const [victimId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Sacrifice : choisissez le personnage de votre banc à sceller',
          options: candidates.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!victimId) return;

        const victim = ctx.getCharacter(victimId);
        const entries = sealableEntries(victim);
        if (entries.length === 0) return;
        const chosenId = await ctx.chooseOption('Sacrifice : choisissez la compétence à sceller', entries);
        if (!chosenId) return;

        // Pas d'API « mettre à jour un statut » : on repose le sceau complet avec la liste
        // augmentée (cf. CLAUDE.md, pattern du compteur persistant).
        const sealedIds = [...sealedIdsOf(victim), chosenId];
        if (hasStatus(victim, SEAL_STATUS_ID)) ctx.removeStatus(victimId, SEAL_STATUS_ID);
        ctx.applyStatus(victimId, {
          statusId: SEAL_STATUS_ID,
          label: sealedStatusLabel(victim, sealedIds),
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          // Aucun `remainingTurns` : un sacrifice ne se reprend pas, le sceau tient toute
          // la partie. C'est ce qui le rend cumulable et ce qui alimente Bang !.
          data: { sealedIds },
        });

        const label = entries.find((e) => e.key === chosenId)?.label ?? chosenId;
        ctx.log(`Sacrifice : ${label} de ${getCharacterCard(victim.cardId).name} est scellé`, {
          kind: 'status',
          characterInstanceId: victimId,
        });
      },
    },
    {
      id: 'manipulation',
      name: 'Manipulation',
      kind: 'active',
      description:
        `Pas Utilisable 2 tours de suite | 2 sacrifices requis.
Désigne 1 carte du banc adverse. Au prochain tour, le personnage actif ennemi est forcé de l'attaquer, ce qui mettra fin à son tour.
(L'activation de cette compétence met fin au tour de Makima).`,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (hasStatus(self, MANIPULATION_COOLDOWN_STATUS_ID)) return false;
        if (countSeals(ctx.state, ctx.ownerId) < MANIPULATION_SEALS_REQUIRED) return false;
        // Sans actif adverse à manipuler ou sans banc adverse à lui faire frapper, il n'y a
        // rien à désigner : la capacité serait dépensée (et le tour fermé) pour rien.
        return !!ctx.getActive(ctx.opponentId) && ctx.getBench(ctx.opponentId).length > 0;
      },
      async execute(ctx) {
        const enemyActive = ctx.getActive(ctx.opponentId);
        const enemyBench = ctx.getBench(ctx.opponentId);
        if (!enemyActive || enemyBench.length === 0) return;

        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Manipulation : désignez la carte du banc adverse à faire attaquer',
          options: enemyBench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;

        // 'forced-attack' est un statut du moteur : c'est lui qui, au début du tour d'en
        // face, retourne l'attaque de l'actif adverse sur son propre banc puis referme son
        // tour (turn.ts::resolveForcedAttack). Une carte ne peut rien faire de tout ça
        // elle-même -- elle n'agit pas pendant le tour adverse et ne ferme pas son tour.
        ctx.applyStatus(enemyActive.instanceId, {
          statusId: 'forced-attack',
          label: 'Manipulé (Makima)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: FORCED_ATTACK_REMAINING_TURNS,
          data: { targetInstanceId: targetId },
        });
        // Marque interne : rien de mécanique, elle sert seulement à ce que le journal et la
        // carte de Makima disent que la manipulation est en cours.
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: MANIPULATION_MARK_STATUS_ID,
          label: 'Manipulation en cours',
          remainingTurns: FORCED_ATTACK_REMAINING_TURNS,
          ticksOnBench: true,
          hidden: true,
        });
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: MANIPULATION_COOLDOWN_STATUS_ID,
          label: 'Manipulation (recharge)',
          remainingTurns: MANIPULATION_COOLDOWN_REMAINING_TURNS,
          ticksOnBench: true,
        });

        ctx.log(
          `Manipulation : ${getCharacterCard(enemyActive.cardId).name} devra frapper ${getCharacterCard(ctx.getCharacter(targetId).cardId).name} au prochain tour`,
          { kind: 'status', characterInstanceId: enemyActive.instanceId }
        );
      },
      // « L'activation de cette compétence met fin au tour de Makima ».
      endsTurn: true,
    },
  ],
  modifiers: [
    {
      // Bang ! : +30 par compétence alliée encore scellée.
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return (current as number) + countSeals(ctx.state, ctx.sourceOwnerId) * BANG_BONUS_PER_SEAL;
      },
    },
    {
      // Le sceau, côté compétences : refuse UNE compétence nommée (active comme passive),
      // pas toutes celles du personnage comme le ferait un silence.
      query: 'canUseAbility',
      vote(ctx) {
        const targetId = ctx.query['characterInstanceId'] as string;
        const abilityId = ctx.query['abilityId'] as string;
        const char = ctx.state.players[ctx.sourceOwnerId].characters[targetId];
        if (!char || !sealedIdsOf(char).includes(abilityId)) return undefined;
        return { allow: false, source: 'makima-sacrifice', reason: 'scellé par Sacrifice' };
      },
    },
    {
      // Le sceau, côté attaque : refuse UNE attaque nommée. Sans `attackId` (une requête
      // qui jauge le personnage en général), on ne refuse rien -- sinon un sceau sur une
      // seule attaque désarmerait un personnage qui en a plusieurs.
      query: 'canAttack',
      vote(ctx) {
        const targetId = ctx.query['characterInstanceId'] as string;
        const attackId = ctx.query['attackId'];
        if (typeof attackId !== 'string') return undefined;
        const char = ctx.state.players[ctx.sourceOwnerId].characters[targetId];
        if (!char || !sealedIdsOf(char).includes(attackId)) return undefined;
        return { allow: false, source: 'makima-sacrifice', reason: 'scellé par Sacrifice' };
      },
    },
  ],
};
