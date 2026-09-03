import type { ObjectCardDef } from '../types.js';
import { getMaxAttachedObjects } from '../../queries.js';

const MAX_HP_BONUS = 200;

export const pocheDeSang: ObjectCardDef = {
  type: 'object',
  id: 'poche-de-sang',
  name: 'Poche de sang',
  equipment: true, // se lie au porteur (ctx.attachSelfTo ci-dessous) au lieu d'être consommée
  description: 'Augmente les hp max de 200, sans augmenter les hp actuel. Cet objet ne soigne pas de 200hp.',
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    const hasRoom = ids.some((id) => {
      const char = player.characters[id];
      return !!char && char.attachedObjectInstanceIds.length < getMaxAttachedObjects(state, id);
    });
    if (!hasRoom) return 'Aucun de vos personnages ne peut porter un objet de plus.';
    return null;
  },
  async execute(ctx) {
    // Seuls les personnages qui ont encore un emplacement d'objet libre : sinon
    // api.attachObject refuse silencieusement (match.ts) et la poche partirait au
    // cimetière après avoir quand même donné ses HP max.
    const candidates = ctx
      .getAllOnBoard(ctx.ownerId)
      .filter((c) => c.attachedObjectInstanceIds.length < getMaxAttachedObjects(ctx.state, c.instanceId));
    if (candidates.length === 0) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Poche de sang : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // `keepCurrentHP` : c'est exactement ce que dit la carte -- le plafond monte, les PV
    // actuels ne bougent pas (sans l'option, raiseMaxHP monterait aussi les PV actuels
    // d'autant, ce qui reviendrait à soigner de 200).
    //
    // Le bonus est un changement d'état permanent, pas un modifier : il n'existe aucune
    // query `getMaxHP` dans le moteur (voir QueryName, cards/types.ts), donc les HP max
    // ne peuvent pas être recalculés en continu à partir des objets en jeu. Conséquence
    // assumée : détruire la poche (terrain Destruction...) ne reprend PAS les 200 HP max.
    ctx.raiseMaxHP(targetId, MAX_HP_BONUS, { keepCurrentHP: true });
  },
};
