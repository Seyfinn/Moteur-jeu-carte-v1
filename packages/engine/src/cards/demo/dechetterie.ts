import type { ObjectCardDef } from '../types.js';
import { getObjectCard } from '../registry.js';
import { randomInt } from '../../rng.js';

export const dechetterie: ObjectCardDef = {
  type: 'object',
  id: 'dechetterie',
  name: 'Déchetterie',
  description:
    "Exemplaire unique. Propose une sélection aléatoire de 2 cartes objets du cimetière adverse (ou moins s'il y en a moins). La carte choisie quitte définitivement le cimetière ennemi et rejoint votre réserve de cartes objets, jouable normalement plus tard.",
  maxCopies: 1,
  async execute(ctx) {
    const enemy = ctx.state.players[ctx.opponentId];
    const pool = [...enemy.graveyardObjectInstanceIds];
    if (pool.length === 0) return;

    const candidates: string[] = [];
    const pickCount = Math.min(2, pool.length);
    for (let i = 0; i < pickCount; i++) {
      const idx = randomInt(ctx.state.rng, pool.length);
      candidates.push(pool[idx]!);
      pool.splice(idx, 1);
    }

    const options = candidates.map((instanceId) => {
      const obj = enemy.objects[instanceId]!;
      return { key: instanceId, label: getObjectCard(obj.cardId).name };
    });
    const chosenId = await ctx.chooseOption('Déchetterie : choisissez la carte objet à récupérer', options);

    const stolen = enemy.objects[chosenId];
    if (!stolen) return;
    const graveyardIdx = enemy.graveyardObjectInstanceIds.indexOf(chosenId);
    if (graveyardIdx !== -1) enemy.graveyardObjectInstanceIds.splice(graveyardIdx, 1);
    delete enemy.objects[chosenId];

    stolen.ownerId = ctx.ownerId;
    const owner = ctx.state.players[ctx.ownerId];
    owner.objects[chosenId] = stolen;
    owner.unplayedObjectInstanceIds.push(chosenId);

    ctx.log(`Déchetterie : récupère ${getObjectCard(stolen.cardId).name} depuis le cimetière adverse`, {
      objectInstanceId: chosenId,
      fromPlayer: ctx.opponentId,
      toPlayer: ctx.ownerId,
    });
  },
};
