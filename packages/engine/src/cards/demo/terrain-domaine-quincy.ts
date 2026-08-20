import type { TerrainCardDef } from '../types.js';

export const terrainDomaineQuincy: TerrainCardDef = {
  type: 'terrain',
  id: 'terrain-domaine-quincy',
  name: 'Terrain : Domaine Quincy',
  description: 'Chaque tour : +10 HP à toutes les cartes alliées, -10 ATK à toutes les cartes ennemies.',
  abilities: [
    {
      id: 'quincy-heal',
      name: 'Domaine Quincy (soin)',
      kind: 'passive',
      trigger: 'onTurnStart',
      description: '+10 HP à toutes les cartes alliées au début de chaque tour du propriétaire.',
      condition(ctx) {
        return ctx.event?.playerId === ctx.ownerId;
      },
      async execute(ctx) {
        for (const ally of ctx.getAllOnBoard(ctx.ownerId)) {
          if (!ctx.isKO(ally.instanceId)) ctx.heal(ally.instanceId, 10);
        }
      },
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      isActive(mctx) {
        const targetInstanceId = mctx.query['characterInstanceId'] as string | undefined;
        if (!targetInstanceId) return false;
        const enemyId = mctx.sourceOwnerId === 'p1' ? 'p2' : 'p1';
        const enemy = mctx.state.players[enemyId];
        return targetInstanceId === enemy.activeCharacterInstanceId || enemy.benchCharacterInstanceIds.includes(targetInstanceId);
      },
      transform(_mctx, current) {
        return (current as number) - 10;
      },
    },
  ],
};
