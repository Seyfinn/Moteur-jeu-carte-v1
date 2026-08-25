import type { ModifierEvalContext, TerrainCardDef } from '../types.js';

const SOURCE = 'terrain:bouclier-ultime';
const DURATION_TURNS = 3;

/** True when this damage instance is hostile damage aimed at the terrain owner's bench. */
function blocksBenchDamage(ctx: ModifierEvalContext): boolean {
  const player = ctx.state.players[ctx.sourceOwnerId];
  const targetInstanceId = ctx.query['targetInstanceId'] as string;
  if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return false;
  return ctx.query['attackerOwnerId'] !== ctx.sourceOwnerId;
}

export const bouclierUltime: TerrainCardDef = {
  type: 'terrain',
  id: 'bouclier-ultime',
  name: 'Bouclier Ultime',
  description:
    `Pendant ${DURATION_TURNS} tours, votre banc devient intouchable : ` +
    'impossible à cibler et immunisé contre tous les dégâts adverses.',
  durationTurns: DURATION_TURNS,
  // Le terrain n'a plus de contrepartie : il ne verrouille plus le poste actif de son
  // possesseur (il portait un modifier `canSwitchStandard` refusant le switch).
  modifiers: [
    // Le banc du possesseur ne peut pas être choisi comme cible (ex: Hook, qui a été adapté pour
    // consulter canTargetBench avant de proposer un perso du banc adverse).
    {
      query: 'canTargetBench',
      vote(ctx) {
        const player = ctx.state.players[ctx.sourceOwnerId];
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return undefined;
        return { allow: false, source: SOURCE };
      },
    },
    // Immunité aux dégâts adverses (classiques et valeur lock) pour le banc du possesseur --
    // couvre attaques/abilities/objets/terrains adverses et les ticks de poison/brûlure, qui
    // passent tous par le même point d'entrée api.dealDamage.
    // NB 1 : n'immunise PAS les dégâts que le possesseur s'inflige lui-même (le coût en HP
    // d'une de ses propres cartes, ex : Soin Sacrificiel de Soraka depuis le banc) -- sinon
    // le terrain rendrait ces coûts gratuits. Reconnu via `attackerOwnerId`, renseigné par
    // le contexte d'effet ; les tics de statuts n'en ont pas et restent donc bloqués.
    // NB 2 : n'immunise pas contre l'application d'un statut lui-même (ex: un stun posé
    // directement sur un perso du banc) -- le moteur n'a pas de hook pour bloquer applyStatus.
    {
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        return blocksBenchDamage(ctx) ? 0 : current;
      },
    },
    {
      query: 'getIncomingValeurLockAmount',
      transform(ctx, current) {
        return blocksBenchDamage(ctx) ? 0 : current;
      },
    },
  ],
};
