import type { ObjectCardDef } from '../types.js';
import type { PlayerId } from '../../types.js';
import { getObjectCard } from '../registry.js';
import { randomInt } from '../../rng.js';

export const dechetterie: ObjectCardDef = {
  type: 'object',
  id: 'dechetterie',
  name: 'Déchetterie',
  description:
    'Permet de récupérer une carte objet parmi une sélection aléatoire de 5 cartes objets des 2 cimetières.',
  maxCopies: 1,
  async execute(ctx) {
    const own = ctx.state.players[ctx.ownerId];
    const enemy = ctx.state.players[ctx.opponentId];
    const pool: Array<{ instanceId: string; ownerId: PlayerId }> = [
      ...own.graveyardObjectInstanceIds.map((instanceId) => ({ instanceId, ownerId: ctx.ownerId })),
      ...enemy.graveyardObjectInstanceIds.map((instanceId) => ({ instanceId, ownerId: ctx.opponentId })),
    ];
    if (pool.length === 0) return;

    const candidates: Array<{ instanceId: string; ownerId: PlayerId }> = [];
    const pickCount = Math.min(5, pool.length);
    for (let i = 0; i < pickCount; i++) {
      const idx = randomInt(ctx.state.rng, pool.length);
      candidates.push(pool[idx]!);
      pool.splice(idx, 1);
    }

    const options = candidates.map(({ instanceId, ownerId }) => {
      const obj = ctx.state.players[ownerId].objects[instanceId]!;
      // `card` : la modale affiche l'illustration réelle plutôt qu'une ligne de texte.
      return { key: instanceId, label: getObjectCard(obj.cardId).name, card: { cardId: obj.cardId, kind: 'object' as const } };
    });
    const chosenId = await ctx.chooseOption('Déchetterie : choisissez la carte objet à récupérer', options);

    const chosen = candidates.find((c) => c.instanceId === chosenId);
    if (!chosen) return;
    const sourcePlayer = ctx.state.players[chosen.ownerId];
    const stolen = sourcePlayer.objects[chosenId];
    if (!stolen) return;
    const graveyardIdx = sourcePlayer.graveyardObjectInstanceIds.indexOf(chosenId);
    if (graveyardIdx !== -1) sourcePlayer.graveyardObjectInstanceIds.splice(graveyardIdx, 1);
    delete sourcePlayer.objects[chosenId];

    stolen.ownerId = ctx.ownerId;
    const owner = ctx.state.players[ctx.ownerId];
    owner.objects[chosenId] = stolen;
    owner.unplayedObjectInstanceIds.push(chosenId);

    ctx.log(`Déchetterie : récupère ${getObjectCard(stolen.cardId).name} depuis un cimetière`, {
      objectInstanceId: chosenId,
      fromPlayer: chosen.ownerId,
      toPlayer: ctx.ownerId,
    });
  },
};
