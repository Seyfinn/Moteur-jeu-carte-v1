import type { CharacterCardDef, EffectContext } from '../types.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { getCharacterCard } from '../registry.js';
import { cardName } from '../../names.js';

/** Nombre de marques "Nom" avant la crise cardiaque. */
const MARKS_TO_KILL = 8;
const CONTRAINTE_DAMAGE_PER_MARK = 50;
/** "Écriture du Nom" : esquive offerte à Light pour le tour adverse qui suit immédiatement.
 *  Posée pendant SON tour, elle n'est décomptée qu'au tick d'ouverture de SON tour suivant
 *  -- donc elle tient telle quelle pendant tout le tour adverse entre les deux, ce qui est
 *  exactement la fenêtre visée. Pas de `+1` : ce n'est pas un statut bloquant posé sur
 *  l'ennemi (voir CLAUDE.md), juste un buff sur soi qui doit survivre un seul tour adverse. */
const EVASION_REMAINING_TURNS = 1;

/**
 * La marque "Nom" portée par l'actif adverse : `data.count` = marques déjà posées. Statut
 * custom sans `remainingTurns` (compteur tenu par la carte, pas un décompte du moteur, cf.
 * le pattern du compteur persistant dans CLAUDE.md), et volontairement visible : c'est
 * l'information la plus importante du plateau pour l'adversaire, qui doit pouvoir décider
 * de fuir à temps.
 */
const NOM_MARK_STATUS_ID = 'light-yagami-marque-nom';

/** Light Yagami tient-il le poste actif ? Toute son exécution en dépend. */
function isOnActivePost(ctx: EffectContext): boolean {
  return ctx.state.players[ctx.ownerId].activeCharacterInstanceId === ctx.sourceInstanceId;
}

function marksOf(ctx: EffectContext, characterInstanceId: string): number {
  const char = ctx.state.players[ctx.opponentId].characters[characterInstanceId];
  if (!char) return 0;
  return Number(getStatus(char, NOM_MARK_STATUS_ID)?.data?.['count'] ?? 0);
}

/**
 * Pose une marque "Nom" de plus sur la cible et déclenche la crise cardiaque une fois les
 * 8 marques atteintes. Point de passage unique du compteur : l'attaque ("Écriture du Nom")
 * comme le tic de fin de tour ("Serment de Vengeance") tombent ici, donc l'échéance se
 * juge au même endroit dans les deux cas.
 *
 * L'esquive se roule ICI, avant de toucher au compteur (`ctx.rollEvasion` puis
 * `skipEvasionRoll` sur la repose) -- comme Marteau de Locke : un jet perdu pendant la
 * repose (remove + reapply n'a pas d'API "update") effacerait sinon les marques déjà
 * posées au lieu de simplement ne pas en ajouter une nouvelle.
 */
async function addNameMark(ctx: EffectContext, targetInstanceId: string): Promise<void> {
  if (ctx.rollEvasion(targetInstanceId)) return;

  const marks = marksOf(ctx, targetInstanceId) + 1;
  const target = ctx.getCharacter(targetInstanceId);

  if (marks >= MARKS_TO_KILL) {
    ctx.log(`${getCharacterCard(target.cardId).name} subit une crise cardiaque`, {
      kind: 'ko',
      characterInstanceId: targetInstanceId,
    });
    await ctx.koCharacter(targetInstanceId);
    return;
  }

  if (hasStatus(target, NOM_MARK_STATUS_ID)) ctx.removeStatus(targetInstanceId, NOM_MARK_STATUS_ID);
  ctx.applyStatus(
    targetInstanceId,
    {
      statusId: NOM_MARK_STATUS_ID,
      label: `Marque du Nom (${marks}/${MARKS_TO_KILL})`,
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { count: marks },
    },
    { skipEvasionRoll: true } // déjà résolu ci-dessus via rollEvasion
  );
}

export const lightYagami: CharacterCardDef = {
  type: 'character',
  id: 'light-yagami',
  name: 'Light Yagami',
  baseMaxHP: 290,
  attacks: [
    {
      id: 'ecriture-du-nom',
      name: 'Écriture du Nom',
      baseATK: 0,
      description: 'Pose une marque "Nom" sur le personnage actif adverse. Octroi au prochain tour esquive à light',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // Aucun dégât : l'attaque ne fait qu'ajouter une marque. Cumulable, donc une
        // deuxième Écriture rapproche encore l'échéance.
        await addNameMark(ctx, target.instanceId);

        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'evasive',
          label: 'Écriture du Nom (esquive)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: EVASION_REMAINING_TURNS,
          ticksOnBench: true, // sinon un Light mis au banc entre-temps gèlerait le compte à rebours
        });
      },
    },
  ],
  abilities: [
    {
      id: 'serment-de-vengeance',
      name: 'Sermet de Vengeance',
      kind: 'passive',
      description:
        'À la fin de ton tour, pose 1 marque "Nom" sur le personnage actif adverse. À 8 marques, il subit une crise cardiaque et la carte Meurt',
      trigger: 'onTurnEnd',
      condition(ctx) {
        // À la fin du tour de Light lui-même, et seulement s'il tient le poste actif : au
        // banc, il ne regarde plus personne.
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        if (!isOnActivePost(ctx)) return false;
        return !!ctx.getActive(ctx.opponentId);
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await addNameMark(ctx, target.instanceId);
      },
    },
    {
      id: 'contrainte',
      name: 'Contrainte',
      kind: 'passive',
      description:
        'Switcher vers le banc efface les marques du personnage qui fuit. En contrepartie, le personnage qui fuit subit 50 dégâts par marque effacée',
      trigger: 'onSwitch',
      condition(ctx) {
        // `onSwitch` n'est émis que pour un vrai changement d'actif, volontaire ou forcé
        // par une carte : le remplacement d'un mort passe, lui, par `onBecomeActive` seul
        // (zones.ts) et ne déclenche donc jamais Contrainte.
        if (ctx.event?.playerId !== ctx.opponentId) return false;
        return isOnActivePost(ctx);
      },
      async execute(ctx) {
        const previousId = ctx.event?.data['previousActiveInstanceId'];
        if (typeof previousId !== 'string') return;

        // « Le personnage qui fuit », pas l'entrant : seules ses propres marques comptent,
        // et lui seul encaisse les dégâts qui en découlent.
        const marks = marksOf(ctx, previousId);
        if (marks <= 0) return;

        ctx.removeStatus(previousId, NOM_MARK_STATUS_ID);
        await ctx.dealDamage(previousId, marks * CONTRAINTE_DAMAGE_PER_MARK);
      },
    },
    {
      id: 'manipulation',
      name: 'Manipulation',
      kind: 'active',
      description:
        "Force le personnage actif ennemi à retourner sur le banc. L'adversaire doit envoyer un nouveau personnage de son choix sur le terrain Utilisable une fois",
      usesPerGame: 1,
      condition(ctx) {
        return !!ctx.getActive(ctx.opponentId) && ctx.getBench(ctx.opponentId).length > 0;
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        const bench = ctx.getBench(ctx.opponentId);
        if (!target || bench.length === 0) return;

        // C'est l'ADVERSAIRE qui choisit son remplaçant, pas Light : `chooseOptionFor`
        // adresse la question à `ctx.opponentId` (cf. Offrande du Dieu de la Mort).
        // `ctx.choose({kind:'select-characters'})` ne sait poser la question qu'au
        // propriétaire de l'effet, donc pas utilisable ici.
        const chosen = await ctx.chooseOptionFor(
          ctx.opponentId,
          'Manipulation : choisissez le personnage qui prend le poste actif',
          bench.map((c) => ({
            key: c.instanceId,
            label: cardName(c.cardId),
            card: { cardId: c.cardId, kind: 'character' as const },
          }))
        );
        const replacementId = bench.some((c) => c.instanceId === chosen) ? chosen : bench[0]!.instanceId;

        // zones.switchActive refuse de lui-même un actif enchaîné ou explicitement bloqué :
        // aucune vérification supplémentaire à faire ici.
        await ctx.forceSwitch(ctx.opponentId, replacementId);
      },
    },
  ],
};
