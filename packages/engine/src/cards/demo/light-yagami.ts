import type { CharacterCardDef, EffectContext } from '../types.js';
import { otherPlayer } from '../../types.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { getCharacterCard } from '../registry.js';

/** Nombre de tours passés d'affilée au poste actif avant la crise cardiaque. */
const DEATH_CLOCK_TURNS = 5;
const CONTRAINTE_DAMAGE = 60;

/**
 * L'horloge portée par l'actif adverse : `data.turns` = tours déjà comptés. Posée sans
 * `remainingTurns` (ce n'est pas un compte à rebours du moteur mais un compteur que la
 * carte tient elle-même, cf. le pattern du compteur persistant dans CLAUDE.md), et
 * volontairement visible : c'est l'information la plus importante du plateau pour
 * l'adversaire, qui doit pouvoir décider de fuir à temps.
 */
const DEATH_CLOCK_STATUS_ID = 'light-yagami-crise';

/** L'emprise de "Manipulation" : bloque le switch de base de celui qui la porte. */
const GRIP_STATUS_ID = 'light-yagami-emprise';
/** Posée sur l'adversaire pendant le tour de Light Yagami : elle doit survivre au tick du
 *  début de SON prochain tour pour le bloquer pendant ce tour-là, d'où le +1. */
const GRIP_REMAINING_TURNS = 1 + 1;

const MANIPULATION_COOLDOWN_STATUS_ID = 'light-yagami-manipulation-recharge';
/** « 2 tours de cooldown » : utilisée au tour N, de retour au tour N+3. Statut bloquant
 *  posé sur soi pendant son propre tour, donc +1 (cf. CLAUDE.md). */
const MANIPULATION_COOLDOWN_REMAINING_TURNS = 2 + 1;

/** Light Yagami tient-il le poste actif ? Toute son exécution en dépend. */
function isOnActivePost(ctx: EffectContext): boolean {
  return ctx.state.players[ctx.ownerId].activeCharacterInstanceId === ctx.sourceInstanceId;
}

function clockTurnsOf(ctx: EffectContext, characterInstanceId: string): number {
  const char = ctx.state.players[ctx.opponentId].characters[characterInstanceId];
  if (!char) return 0;
  return Number(getStatus(char, DEATH_CLOCK_STATUS_ID)?.data?.['turns'] ?? 0);
}

/**
 * Avance l'horloge de `by` et déclenche la crise cardiaque une fois l'heure atteinte.
 * Point de passage unique du compteur : le tour qui s'écoule (Serment de Vengeance) comme
 * l'avance forcée (Écriture du Nom) tombent ici, donc l'heure de la mort se juge au même
 * endroit dans les deux cas.
 */
async function advanceDeathClock(ctx: EffectContext, targetInstanceId: string, by: number): Promise<void> {
  const turns = clockTurnsOf(ctx, targetInstanceId) + by;
  const target = ctx.getCharacter(targetInstanceId);

  if (turns >= DEATH_CLOCK_TURNS) {
    ctx.log(`${getCharacterCard(target.cardId).name} subit une crise cardiaque`, {
      kind: 'ko',
      characterInstanceId: targetInstanceId,
    });
    await ctx.koCharacter(targetInstanceId);
    return;
  }

  // Pas d'API « mettre à jour un statut » : on repose le compteur avec sa nouvelle valeur.
  if (hasStatus(target, DEATH_CLOCK_STATUS_ID)) ctx.removeStatus(targetInstanceId, DEATH_CLOCK_STATUS_ID);
  ctx.applyStatus(targetInstanceId, {
    statusId: DEATH_CLOCK_STATUS_ID,
    label: `Heure de la mort (${turns}/${DEATH_CLOCK_TURNS})`,
    sourcePlayerId: ctx.ownerId,
    sourceCardInstanceId: ctx.sourceInstanceId,
    data: { turns },
  });
}

export const lightYagami: CharacterCardDef = {
  type: 'character',
  id: 'light-yagami',
  name: 'Light Yagami',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'ecriture-du-nom',
      name: 'Écriture du Nom',
      baseATK: 0,
      description: "Avance l'heure de la mort d'un tour.",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // Aucun dégât : l'attaque ne fait qu'avancer le compteur. Cumulable, donc une
        // deuxième Écriture rapproche encore l'échéance.
        await advanceDeathClock(ctx, target.instanceId, 1);
      },
    },
  ],
  abilities: [
    {
      id: 'serment-de-vengeance',
      name: 'Sermet de Vengeance',
      kind: 'passive',
      description:
        "Si le personnage ennemi reste sur le poste actif pendant 5 tours d'affilé, il subit une crise cardiaque (KO instantané).",
      trigger: 'onTurnStart',
      condition(ctx) {
        // Un tour de l'adversaire qui commence, et Light Yagami doit tenir le poste actif :
        // au banc, il ne regarde plus personne et l'horloge s'arrête là où elle en est.
        if (ctx.event?.playerId !== ctx.opponentId) return false;
        if (!isOnActivePost(ctx)) return false;
        return !!ctx.getActive(ctx.opponentId);
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await advanceDeathClock(ctx, target.instanceId, 1);
      },
    },
    {
      id: 'contrainte',
      name: 'Contrainte',
      kind: 'passive',
      description: "Switcher vers le banc annule l'exécution, mais le personnage entrant subit 60 dégâts",
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
        const newActiveId = ctx.event?.data['newActiveInstanceId'];

        // « Annule l'exécution » : le compte « d'affilé » repart de zéro. Nettoyé des deux
        // côtés du switch -- celui qui s'échappe emporte sinon son compteur au banc et le
        // retrouverait intact en revenant.
        if (typeof previousId === 'string') ctx.removeStatus(previousId, DEATH_CLOCK_STATUS_ID);
        if (typeof newActiveId !== 'string') return;
        ctx.removeStatus(newActiveId, DEATH_CLOCK_STATUS_ID);

        await ctx.dealDamage(newActiveId, CONTRAINTE_DAMAGE);
      },
    },
    {
      id: 'manipulation',
      name: 'Manipulation',
      kind: 'active',
      description: "Empêche le personnage actif adverse d'effectuer un switch lors de son prochain tour. 2 tours de cooldown",
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (hasStatus(self, MANIPULATION_COOLDOWN_STATUS_ID)) return false;
        return !!ctx.getActive(ctx.opponentId);
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        ctx.applyStatus(target.instanceId, {
          statusId: GRIP_STATUS_ID,
          label: 'Manipulation (switch bloqué)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: GRIP_REMAINING_TURNS,
        });
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: MANIPULATION_COOLDOWN_STATUS_ID,
          label: 'Manipulation (recharge)',
          remainingTurns: MANIPULATION_COOLDOWN_REMAINING_TURNS,
          ticksOnBench: true,
        });
      },
    },
  ],
  modifiers: [
    {
      // L'emprise ne ferme que l'action de switch du joueur. Volontairement pas le statut
      // 'chained' du moteur, qui bloquerait AUSSI les switchs forcés par une carte : le
      // texte ne parle que du switch que l'adversaire déciderait lui-même.
      query: 'canSwitchStandard',
      vote(ctx) {
        const leavingId = ctx.query['characterInstanceId'] as string;
        const enemy = ctx.state.players[otherPlayer(ctx.sourceOwnerId)];
        const char = enemy.characters[leavingId];
        if (!char || !hasStatus(char, GRIP_STATUS_ID)) return undefined;
        return { allow: false, source: 'light-yagami-manipulation', reason: 'manipulé (Light Yagami)' };
      },
    },
  ],
};
