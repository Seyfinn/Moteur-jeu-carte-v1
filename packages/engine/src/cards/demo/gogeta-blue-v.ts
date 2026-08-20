import type { CharacterCardDef } from '../types.js';
import type { PlayerId } from '../../types.js';
import { simpleAttack } from './shared.js';

export const gogetaBlueV: CharacterCardDef = {
  type: 'character',
  id: 'gogeta-blue-v',
  name: 'Gogeta Blue V',
  baseMaxHP: 170,
  abilities: [],
  attacks: [simpleAttack('true-beam', 'True Beam', 130, "Inflige 130 dégâts au personnage actif adverse.")],
  modifiers: [
    {
      // "quand cette carte est sur le poste actif, active 2x par tour le terrain"
      query: 'getTriggerFireCount',
      isActive(mctx) {
        const player = mctx.state.players[mctx.sourceOwnerId];
        return player.activeCharacterInstanceId === mctx.sourceInstanceId;
      },
      transform(mctx, current) {
        const q = mctx.query as { sourceKind?: string; sourceOwnerId?: PlayerId; eventName?: string };
        const isOwnTerrainTurnStart =
          q.sourceKind === 'terrain' && q.sourceOwnerId === mctx.sourceOwnerId && q.eventName === 'onTurnStart';
        return isOwnTerrainTurnStart ? (current as number) * 2 : current;
      },
    },
    {
      // "si il n'y a pas de terrain, protège le banc de tout les effets qui le cible"
      query: 'canTargetBench',
      isActive(mctx) {
        const player = mctx.state.players[mctx.sourceOwnerId];
        const isActiveChar = player.activeCharacterInstanceId === mctx.sourceInstanceId;
        return isActiveChar && !player.activeTerrainInstanceId;
      },
      vote(mctx) {
        const targetInstanceId = mctx.query['targetInstanceId'] as string | undefined;
        if (!targetInstanceId) return undefined;
        const ownBench = mctx.state.players[mctx.sourceOwnerId].benchCharacterInstanceIds;
        if (!ownBench.includes(targetInstanceId)) return undefined;
        return { allow: false, source: 'gogeta-blue-v:fusion-supreme' };
      },
    },
  ],
};
