import type { ObjectCardDef } from '../types.js';
import { getObjectCard, getTerrainCard } from '../registry.js';

const SACRIFICE_COUNT = 2;

export const echangeEquivalent: ObjectCardDef = {
  type: 'object',
  id: 'echange-equivalent',
  name: 'Echange équivalent',
  description: `Sacrifiez ${SACRIFICE_COUNT} cartes de votre réserve non jouée (objets ou terrains, au choix). En échange, récupérez une carte objet ou terrain au choix dans votre cimetière.`,
  async execute(ctx) {
    const player = ctx.state.players[ctx.ownerId];

    const sacrificePool = [
      ...player.unplayedObjectInstanceIds.map((instanceId) => ({
        instanceId,
        kind: 'object' as const,
        name: getObjectCard(player.objects[instanceId]!.cardId).name,
      })),
      ...player.unplayedTerrainInstanceIds.map((instanceId) => ({
        instanceId,
        kind: 'terrain' as const,
        name: getTerrainCard(player.terrains[instanceId]!.cardId).name,
      })),
    ];
    if (sacrificePool.length < SACRIFICE_COUNT) return;

    const chosenIds = await ctx.choose({
      kind: 'select-characters',
      prompt: `Echange équivalent : choisissez ${SACRIFICE_COUNT} cartes (objet ou terrain) de votre réserve à sacrifier`,
      options: sacrificePool.map((c) => c.instanceId),
      min: SACRIFICE_COUNT,
      max: SACRIFICE_COUNT,
    });

    for (const instanceId of chosenIds) {
      const sacrificed = sacrificePool.find((c) => c.instanceId === instanceId);
      if (!sacrificed) continue;
      if (sacrificed.kind === 'object') {
        const idx = player.unplayedObjectInstanceIds.indexOf(instanceId);
        if (idx !== -1) player.unplayedObjectInstanceIds.splice(idx, 1);
        player.graveyardObjectInstanceIds.push(instanceId);
      } else {
        const idx = player.unplayedTerrainInstanceIds.indexOf(instanceId);
        if (idx !== -1) player.unplayedTerrainInstanceIds.splice(idx, 1);
        player.graveyardTerrainInstanceIds.push(instanceId);
      }
    }

    const recoverPool = [
      ...player.graveyardObjectInstanceIds.map((instanceId) => ({
        instanceId,
        kind: 'object' as const,
        name: getObjectCard(player.objects[instanceId]!.cardId).name,
      })),
      ...player.graveyardTerrainInstanceIds.map((instanceId) => ({
        instanceId,
        kind: 'terrain' as const,
        name: getTerrainCard(player.terrains[instanceId]!.cardId).name,
      })),
    ];
    if (recoverPool.length === 0) return;

    const recoveredId = await ctx.chooseOption(
      'Echange équivalent : choisissez la carte objet ou terrain à récupérer de votre cimetière',
      recoverPool.map((c) => ({ key: c.instanceId, label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'})` }))
    );
    const recovered = recoverPool.find((c) => c.instanceId === recoveredId);
    if (!recovered) return;

    if (recovered.kind === 'object') {
      const idx = player.graveyardObjectInstanceIds.indexOf(recoveredId);
      if (idx !== -1) player.graveyardObjectInstanceIds.splice(idx, 1);
      player.unplayedObjectInstanceIds.push(recoveredId);
    } else {
      const idx = player.graveyardTerrainInstanceIds.indexOf(recoveredId);
      if (idx !== -1) player.graveyardTerrainInstanceIds.splice(idx, 1);
      player.unplayedTerrainInstanceIds.push(recoveredId);
    }

    ctx.log(`Echange équivalent : récupère ${recovered.name}`, { instanceId: recoveredId, kind: recovered.kind });
  },
};
