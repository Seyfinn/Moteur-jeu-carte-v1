import type { ObjectCardDef } from '../types.js';
import { getObjectCard, getTerrainCard, listCards } from '../registry.js';
import { DECK_LIMITS } from '../../deck.js';

const SACRIFICE_COUNT = 2;

export const echangeEquivalent: ObjectCardDef = {
  type: 'object',
  id: 'echange-equivalent',
  name: 'Echange équivalent',
  description: 'Sacrifier 2 cartes, objets ou terrain. En échange, vous permet de récupérer une carte objet ou terrain parmi toutes les cartes du jeu.',
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

    // "Parmi toutes les cartes du jeu" : n'importe quel objet ou terrain enregistré, pas
    // seulement ceux déjà possédés -- une copie toute neuve est fabriquée (createObject /
    // createTerrain), toujours plafonnée par le nombre max d'exemplaires du deck (même
    // règle que Caméléon : une carte déjà à son plafond, dont un exemplaire unique dès sa
    // première copie, n'est pas proposée).
    const recoverPool: Array<{ cardId: string; kind: 'object' | 'terrain'; name: string }> = [];
    for (const def of listCards()) {
      if (def.type !== 'object' && def.type !== 'terrain') continue;
      const maxCopies = def.maxCopies ?? DECK_LIMITS.maxCopiesPerCard;
      const currentCopies =
        def.type === 'object'
          ? Object.values(player.objects).filter((o) => o.cardId === def.id).length
          : Object.values(player.terrains).filter((t) => t.cardId === def.id).length;
      if (currentCopies < maxCopies) {
        recoverPool.push({ cardId: def.id, kind: def.type, name: def.name });
      }
    }
    if (recoverPool.length === 0) return;

    const recoveredCardId = await ctx.chooseOption(
      'Echange équivalent : choisissez la carte objet ou terrain à récupérer',
      // `card` : la modale affiche l'illustration réelle plutôt qu'une ligne de texte.
      recoverPool.map((c) => ({
        key: c.cardId,
        label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'})`,
        card: { cardId: c.cardId, kind: c.kind },
      }))
    );
    const recovered = recoverPool.find((c) => c.cardId === recoveredCardId);
    if (!recovered) return;

    if (recovered.kind === 'object') {
      ctx.createObject(recovered.cardId);
    } else {
      ctx.createTerrain(recovered.cardId);
    }

    ctx.log(`Echange équivalent : récupère ${recovered.name}`, { cardId: recovered.cardId, kind: recovered.kind });
  },
};
