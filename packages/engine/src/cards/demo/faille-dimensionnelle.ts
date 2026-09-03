import type { TerrainCardDef } from '../types.js';
import type { PlayerId, TerrainInstance } from '../../types.js';

const SOURCE = 'terrain:faille-dimensionnelle';
const DURATION_TURNS = 5;
const FREE_SWITCHES = 2;

/**
 * Charges restantes pour ce camp, rangées dans le `data` libre de l'instance de terrain.
 * Absent = personne n'a encore switché de ce côté : les deux charges sont là.
 */
function remainingFor(terrain: TerrainInstance, playerId: PlayerId): number {
  const raw = terrain.data?.[playerId];
  return typeof raw === 'number' ? raw : FREE_SWITCHES;
}

export const failleDimensionnelle: TerrainCardDef = {
  type: 'terrain',
  id: 'faille-dimensionnelle',
  name: 'Faille dimensionnelle',
  description: "Tous les joueurs peuvent switch gratuitement jusqu'à 2 fois pendant la durée de ce terrain.",
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'faille-dimensionnelle-charges',
      name: 'Passage libre',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description:
        "Seuls les changements décidés par le joueur consomment une charge : un switch imposé par une carte adverse reste gratuit et n'en retire aucune.",
      trigger: 'onSwitch',
      // `reason: 'action'` = le joueur a lui-même demandé ce switch. Un `forceSwitch` de
      // carte porte 'forced' : il ne passe déjà pas par l'action de switch (donc il ne
      // ferme aucun tour), le facturer reviendrait à punir la victime.
      condition(ctx) {
        return ctx.event?.data['reason'] === 'action';
      },
      async execute(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return;
        const terrain = ctx.getTerrain(ctx.sourceInstanceId);
        const remaining = remainingFor(terrain, playerId);
        // 0 charge : c'était un switch ordinaire, qui a fermé le tour. Rien à décompter.
        if (remaining <= 0) return;
        terrain.data = { ...terrain.data, [playerId]: remaining - 1 };
        ctx.log(
          `Faille dimensionnelle : switch gratuit (${remaining - 1} restant${remaining - 1 > 1 ? 's' : ''})`,
          { kind: 'info', playerId }
        );
      },
    },
  ],
  modifiers: [
    {
      // Le seul endroit du moteur où `doesActionEndTurn` est consulté (match.ts::runAction).
      // Voter `allow: false` veut dire « cette action NE ferme PAS le tour ». La question
      // est posée avant le switch, donc avec le compteur encore intact ; c'est le trigger
      // `onSwitch` ci-dessus qui le fait descendre juste après.
      query: 'doesActionEndTurn',
      vote(ctx) {
        if (ctx.query['actionKind'] !== 'switch') return undefined;
        const playerId = ctx.query['playerId'] as PlayerId;
        const terrain = ctx.state.players[ctx.sourceOwnerId].terrains[ctx.sourceInstanceId];
        if (!terrain || remainingFor(terrain, playerId) <= 0) return undefined;
        return { allow: false, source: SOURCE, reason: 'Faille dimensionnelle' };
      },
    },
  ],
};
