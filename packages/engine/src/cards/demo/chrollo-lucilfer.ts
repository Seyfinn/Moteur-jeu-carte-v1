import type { AbilityDef, AttackDef, CharacterCardDef, EffectContext } from '../types.js';
import type { CharacterInstance } from '../../types.js';
import { otherPlayer } from '../../types.js';
import { getCurrentHP } from '../../hp.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { getCharacterCard } from '../registry.js';
import { isRelaunchable } from './shared.js';

const DAGUE_ATK = 45;
/** « Chrollo perd 25 % de ses PV actuels au début de chacun de tes tours ». */
const BLEED_PERCENT_OF_CURRENT_HP = 25;

/**
 * Le scellement, porté par la VICTIME (un personnage du camp adverse). Il vit sur elle et
 * pas sur Chrollo : c'est elle qui ne peut plus agir, et sa mort doit rendre le livre.
 * `data.stolenAttackId` / `data.stolenAbilityId` retiennent ce que Chrollo a pris.
 */
const SEAL_STATUS_ID = 'chrollo-scellement';

/** Marque portée par Chrollo tant qu'un livre est ouvert : `data.victimInstanceId`. */
const BOOK_STATUS_ID = 'chrollo-livre-ouvert';

/**
 * Clé de `ctx.scratch` par laquelle « Actif volé » transmet à son `endsTurn` ce que la
 * capacité volée coûtait à sa propriétaire (cf. CLAUDE.md, pattern "Voracity") : `match.ts`
 * passe le MÊME contexte à `execute` et à `endsTurn`, et évalue le second après le premier.
 */
const STOLEN_ENDS_TURN = 'chrollo:stolenEndsTurn';

/** La victime actuellement scellée par ce Chrollo, si elle est toujours sur le plateau. */
function sealedVictim(ctx: EffectContext): CharacterInstance | undefined {
  const self = ctx.getCharacter(ctx.sourceInstanceId);
  const victimId = getStatus(self, BOOK_STATUS_ID)?.data?.['victimInstanceId'];
  if (typeof victimId !== 'string') return undefined;
  const victim = ctx.state.players[ctx.opponentId].characters[victimId];
  if (!victim || !hasStatus(victim, SEAL_STATUS_ID)) return undefined;
  // Partie au cimetière entre-temps : le livre se referme tout seul.
  const enemy = ctx.state.players[ctx.opponentId];
  const onBoard =
    enemy.activeCharacterInstanceId === victimId || enemy.benchCharacterInstanceIds.includes(victimId);
  return onBoard ? victim : undefined;
}

/**
 * Une entrée volée s'exécute AVEC CHROLLO POUR SOURCE : sa propre condition doit donc tenir
 * pour lui, ici et maintenant (`isRelaunchable`, partagé avec le Spell Thief de Zoé). Un
 * compteur qui vit chez sa victime ne le suit pas -- sans ce test, voler « Cycle 4 - Soleil »
 * à Escanor lui offrait 150 ATK à chaque tour en court-circuitant tout le cycle qui la
 * conditionne.
 */
const usableByChrollo = isRelaunchable;

/**
 * L'attaque volée, telle qu'elle est aujourd'hui : lue sur la carte de la victime à chaque
 * coup. Passe par `sealedVictim` : une victime partie au cimetière garde son sceau (un KO
 * ne vide pas les statuts), mais le livre est refermé -- sans ce test Chrollo gardait
 * l'attaque volée gratuitement alors que la Contrainte, elle, avait déjà cessé.
 */
function stolenAttack(ctx: EffectContext): AttackDef | undefined {
  const victim = sealedVictim(ctx);
  const self = ctx.getCharacter(ctx.sourceInstanceId);
  const attackId = getStatus(self, BOOK_STATUS_ID)?.data?.['stolenAttackId'];
  if (!victim || typeof attackId !== 'string') return undefined;
  const attack = getCharacterCard(victim.cardId).attacks.find((a) => a.id === attackId);
  // Attaque volée inutilisable en l'état : Chrollo retombe sur sa Dague de Ben.
  return attack && usableByChrollo(attack, ctx) ? attack : undefined;
}

/** La capacité active volée, même principe. */
function stolenAbility(ctx: EffectContext): AbilityDef | undefined {
  const victim = sealedVictim(ctx);
  const self = ctx.getCharacter(ctx.sourceInstanceId);
  const abilityId = getStatus(self, BOOK_STATUS_ID)?.data?.['stolenAbilityId'];
  if (!victim || typeof abilityId !== 'string') return undefined;
  const ability = getCharacterCard(victim.cardId).abilities.find((a) => a.id === abilityId);
  return ability && usableByChrollo(ability, ctx) ? ability : undefined;
}

export const chrolloLucilfer: CharacterCardDef = {
  type: 'character',
  id: 'chrollo-lucilfer',
  name: 'Chrollo Lucilfer',
  baseMaxHP: 225,
  attacks: [
    {
      id: 'dague-de-ben',
      name: 'Dague de Ben',
      baseATK: DAGUE_ATK,
      description: '',
      async execute(ctx) {
        // Tant qu'un livre est ouvert, cette entrée d'attaque EST l'attaque volée : on
        // délègue à son `execute`, donc elle calcule elle-même son ATK depuis SA base et
        // garde tous ses effets annexes (poison, silence, ciblage du banc...).
        // ⚠️ Corollaire assumé : le bouton du panneau continue d'afficher « Dague de Ben,
        // 45 ATK ». Un modifier getEffectiveATK qui corrigerait l'affichage fausserait le
        // calcul de l'attaque déléguée (elle repartirait de sa propre base, déjà décalée).
        // Le journal, lui, annonce le vrai nom à chaque coup.
        const stolen = stolenAttack(ctx);
        if (stolen) {
          ctx.log(`Chrollo Lucilfer utilise ${stolen.name} (volée)`, {
            kind: 'attack',
            characterInstanceId: ctx.sourceInstanceId,
            attackId: stolen.id,
          });
          await stolen.execute(ctx);
          return;
        }

        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, ctx.getEffectiveATK(ctx.sourceInstanceId, DAGUE_ATK));
      },
    },
  ],
  abilities: [
    {
      id: 'double-face-annulation',
      name: 'Double Face : Annulation',
      kind: 'active',
      description:
        `L'adversaire doit avoir au moins un autre personnage en vie.
Envoie le personnage actif adverse sur son banc et le Scelle (il ne peut plus agir).
Chrollo remplace son attaque par l'Attaque de l'ennemi scellé et cet actif par l'actif de l'ennemi est scellé.
Tant que la carte est scellée, Chrollo perd 25 % de ses PV actuels au début de chaque tour.`,
      condition(ctx) {
        // Un seul livre à la fois : Double Face ne se relance qu'une fois la page tournée.
        if (sealedVictim(ctx)) return false;
        if (!ctx.getActive(ctx.opponentId)) return false;
        // « L'adversaire doit avoir au moins un autre personnage en vie » : il faut quelqu'un
        // pour prendre le poste actif que la victime va libérer.
        return ctx.getBench(ctx.opponentId).length > 0;
      },
      async execute(ctx) {
        const victim = ctx.getActive(ctx.opponentId);
        const enemyBench = ctx.getBench(ctx.opponentId);
        if (!victim || enemyBench.length === 0) return;

        // Chrollo choisit ce qu'il vole, quand la carte offre plusieurs entrées.
        const victimCard = getCharacterCard(victim.cardId);
        // Ne proposer que ce que Chrollo pourra réellement porter : une entrée dont la
        // condition s'appuie sur un compteur propre à la victime (le cycle d'Escanor) ne
        // s'ouvrira jamais pour lui, la lui offrir serait un piège.
        const stealableAttacks = victimCard.attacks.filter((a) => usableByChrollo(a, ctx));
        const stealableAbilities = victimCard.abilities.filter(
          (a) => a.kind === 'active' && !a.trigger && usableByChrollo(a, ctx)
        );

        let stolenAttackId = stealableAttacks[0]?.id;
        if (stealableAttacks.length > 1) {
          stolenAttackId =
            (await ctx.chooseOption(
              `Double Face : quelle attaque de ${victimCard.name} volez-vous ?`,
              stealableAttacks.map((a) => ({ key: a.id, label: `${a.name} (${a.baseATK} ATK)` }))
            )) ?? stolenAttackId;
        }

        let stolenAbilityId = stealableAbilities[0]?.id;
        if (stealableAbilities.length > 1) {
          stolenAbilityId =
            (await ctx.chooseOption(
              `Double Face : quel actif de ${victimCard.name} volez-vous ?`,
              stealableAbilities.map((a) => ({ key: a.id, label: a.name }))
            )) ?? stolenAbilityId;
        }

        // L'adversaire choisit qui monte au poste actif : c'est son équipe.
        let replacementId = enemyBench[0]!.instanceId;
        if (enemyBench.length > 1) {
          const answer = await ctx.chooseOptionFor(
            ctx.opponentId,
            'Double Face : choisissez le personnage qui prend le poste actif',
            enemyBench.map((c) => ({
              key: c.instanceId,
              label: `${getCharacterCard(c.cardId).name} (${getCurrentHP(c)} PV)`,
              card: { cardId: c.cardId, kind: 'character' as const },
            }))
          );
          if (answer && enemyBench.some((c) => c.instanceId === answer)) replacementId = answer;
        }

        // Le sceau est posé AVANT le switch : sinon le modifier `canSwitchAny` ci-dessous
        // ne verrait rien et la victime pourrait être remontée dans la foulée.
        ctx.applyStatus(victim.instanceId, {
          statusId: SEAL_STATUS_ID,
          label: 'Scellé (Double Face)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { stolenAttackId, stolenAbilityId },
        });
        // Une marque périmée (victime précédente morte sans Fermeture du Livre) est
        // remplacée, jamais empilée : `getStatus` lirait sinon toujours la première.
        ctx.removeStatus(ctx.sourceInstanceId, BOOK_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: BOOK_STATUS_ID,
          label: `Livre ouvert (${victimCard.name})`,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { victimInstanceId: victim.instanceId, stolenAttackId, stolenAbilityId },
        });

        await ctx.forceSwitch(ctx.opponentId, replacementId);
      },
    },
    {
      // Le second morceau du vol. Il lui faut sa propre entrée : les capacités d'un
      // personnage sont déclarées en dur, il n'y a pas moyen d'en greffer une à chaud sur
      // "Double Face". La description reprend mot pour mot la phrase de la carte qui
      // annonce ce vol -- elle n'est activable que quand un livre est effectivement ouvert.
      id: 'actif-vole',
      name: 'Actif volé',
      kind: 'active',
      description: "Chrollo remplace son attaque par l'Attaque de l'ennemi scellé et cet actif par l'actif de l'ennemi est scellé.",
      condition(ctx) {
        return !!stolenAbility(ctx);
      },
      // Chrollo rejoue la capacité telle qu'elle est, coût compris : celle qui fermait le
      // tour de sa propriétaire ("Manipulation" de Makima) ferme aussi le sien.
      endsTurn(ctx) {
        return ctx.scratch[STOLEN_ENDS_TURN] === true;
      },
      async execute(ctx) {
        const stolen = stolenAbility(ctx);
        if (!stolen) return;
        // Relancée avec Chrollo pour source, comme le Spell Thief de Zoé : c'est lui qui
        // en paie le prix et en récolte l'effet, pas la victime.
        ctx.log(`Chrollo Lucilfer utilise ${stolen.name} (volée)`, {
          kind: 'use-ability',
          characterInstanceId: ctx.sourceInstanceId,
          abilityId: stolen.id,
        });
        await stolen.execute(ctx);

        // Évalué après coup, sur le même contexte, exactement comme `match.ts` le ferait
        // pour la capacité d'origine.
        const cost = stolen.endsTurn;
        ctx.scratch[STOLEN_ENDS_TURN] = typeof cost === 'function' ? cost(ctx) : cost === true;
      },
    },
    {
      id: 'fermeture-du-livre',
      name: 'Fermeture du Livre',
      kind: 'active',
      description:
        'Annule le Scellement de la carte ennemie (elle peut de nouveau agir sur le banc). Chrollo stoppe immédiatement la perte de 25 % de PV par tour et récupère son attaque de base Dague de Ben.',
      condition(ctx) {
        return !!sealedVictim(ctx) || hasStatus(ctx.getCharacter(ctx.sourceInstanceId), BOOK_STATUS_ID);
      },
      async execute(ctx) {
        const victim = sealedVictim(ctx);
        if (victim) ctx.removeStatus(victim.instanceId, SEAL_STATUS_ID);
        // Retirée dans tous les cas, même si la victime est morte entre-temps : c'est cette
        // marque qui porte la saignée et l'attaque volée.
        ctx.removeStatus(ctx.sourceInstanceId, BOOK_STATUS_ID);
      },
    },
    {
      id: 'double-face-contrainte',
      // Le troisième paragraphe de Double Face, que la carte imprimée intitule elle-même
      // « Contrainte » : il lui faut sa propre entrée parce qu'une capacité activable ne
      // peut pas, en plus, réagir à un event (un `trigger` la rendrait non activable).
      name: 'Contrainte',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description:
        'Contrainte : Tant que la carte est scellée, Chrollo perd 25 % de ses PV actuels au début de chacun de tes tours.',
      trigger: 'onTurnStart',
      usableFromBench: true,
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        return !!sealedVictim(ctx);
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        // `Math.floor` volontaire, et pas de plancher à 1 : la saignée ne doit jamais tuer
        // Chrollo. En dessous de 4 PV elle ne retire donc plus rien, le livre reste ouvert.
        const loss = Math.floor(getCurrentHP(self) * (BLEED_PERCENT_OF_CURRENT_HP / 100));
        if (loss <= 0) return;
        // Coût que Chrollo se paie à lui-même : ni bouclier ni réduction ne doivent le rendre
        // gratuit (cf. CLAUDE.md, Adrénaline Ultime).
        await ctx.dealDamage(ctx.sourceInstanceId, loss, { ignoreShield: true, ignoreDamageReduction: true });
      },
    },
  ],
  modifiers: [
    {
      // « il ne peut plus agir » : aucune capacité, ni active ni passive à trigger.
      query: 'canUseAbility',
      vote(ctx) {
        const enemy = ctx.state.players[otherPlayer(ctx.sourceOwnerId)];
        const char = enemy.characters[ctx.query['characterInstanceId'] as string];
        if (!char || !hasStatus(char, SEAL_STATUS_ID)) return undefined;
        return { allow: false, source: 'chrollo-scellement', reason: 'scellé par Double Face' };
      },
    },
    {
      // Une carte scellée ne peut pas non plus attaquer : elle serait sinon libre dès qu'un
      // effet la ramènerait au poste actif.
      query: 'canAttack',
      vote(ctx) {
        const enemy = ctx.state.players[otherPlayer(ctx.sourceOwnerId)];
        const char = enemy.characters[ctx.query['characterInstanceId'] as string];
        if (!char || !hasStatus(char, SEAL_STATUS_ID)) return undefined;
        return { allow: false, source: 'chrollo-scellement', reason: 'scellé par Double Face' };
      },
    },
    {
      // ... et ne peut pas revenir au poste actif, switch forcé compris.
      // ⚠️ Le remplacement d'un personnage KO ne passe pas par `canSwitchAny` (voir
      // zones.koCharacter) : si l'adversaire n'a plus que des scellés, l'un d'eux prend
      // quand même le poste. Sans cette porte de sortie, la partie se bloquerait.
      query: 'canSwitchAny',
      vote(ctx) {
        const enemy = ctx.state.players[otherPlayer(ctx.sourceOwnerId)];
        const incoming = enemy.characters[ctx.query['incomingInstanceId'] as string];
        if (!incoming || !hasStatus(incoming, SEAL_STATUS_ID)) return undefined;
        return { allow: false, source: 'chrollo-scellement', reason: 'scellé par Double Face' };
      },
    },
  ],
};
