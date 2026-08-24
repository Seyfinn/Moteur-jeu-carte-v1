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
        cardId: player.objects[instanceId]!.cardId,
        kind: 'object' as const,
        name: getObjectCard(player.objects[instanceId]!.cardId).name,
      })),
      ...player.unplayedTerrainInstanceIds.map((instanceId) => ({
        instanceId,
        cardId: player.terrains[instanceId]!.cardId,
        kind: 'terrain' as const,
        name: getTerrainCard(player.terrains[instanceId]!.cardId).name,
      })),
    ];
    if (sacrificePool.length < SACRIFICE_COUNT) return;

    // Une par une via chooseOption : `choose({kind:'select-characters'})` ne sait
    // afficher que des personnages côté client -- lui passer des instances d'objet ou
    // de terrain donnerait une modale vide et bloquerait la partie.
    const chosenIds: string[] = [];
    const remaining = [...sacrificePool];
    for (let i = 0; i < SACRIFICE_COUNT; i++) {
      const chosenId = await ctx.chooseOption(
        `Echange équivalent : choisissez la carte à sacrifier (${i + 1}/${SACRIFICE_COUNT})`,
        // `card` : la modale affiche l'illustration réelle plutôt qu'une ligne de texte.
        remaining.map((c) => ({
          key: c.instanceId,
          label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'})`,
          card: { cardId: c.cardId, kind: c.kind },
        }))
      );
      const pickedIndex = remaining.findIndex((c) => c.instanceId === chosenId);
      const picked = pickedIndex === -1 ? remaining[0] : remaining[pickedIndex];
      if (!picked) return;
      remaining.splice(pickedIndex === -1 ? 0 : pickedIndex, 1);
      chosenIds.push(picked.instanceId);
    }

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
        cardId: player.objects[instanceId]!.cardId,
        kind: 'object' as const,
        name: getObjectCard(player.objects[instanceId]!.cardId).name,
      })),
      ...player.graveyardTerrainInstanceIds.map((instanceId) => ({
        instanceId,
        cardId: player.terrains[instanceId]!.cardId,
        kind: 'terrain' as const,
        name: getTerrainCard(player.terrains[instanceId]!.cardId).name,
      })),
    ];
    if (recoverPool.length === 0) return;

    const recoveredId = await ctx.chooseOption(
      'Echange équivalent : choisissez la carte objet ou terrain à récupérer de votre cimetière',
      recoverPool.map((c) => ({
        key: c.instanceId,
        label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'})`,
        card: { cardId: c.cardId, kind: c.kind },
      }))
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
