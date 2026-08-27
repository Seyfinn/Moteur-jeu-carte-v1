import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const BOOST_AMOUNT = 50;
const BOOST_DURATION_TURNS = 1;

export const potionForce: ObjectCardDef = {
  type: 'object',
  id: 'potion-force',
  name: 'Potion force',
  // À lier (maquette) : s'accroche au personnage choisi (ctx.attachSelfTo ci-dessous). Le
  // statut 'atk-boost' porte data.objectInstanceId, donc statuses.ts détruit l'objet tout
  // seul dès que le buff expire naturellement -- rien ne reste accroché pour rien une fois
  // le tour de bonus terminé (même convention qu'Attaque cloné).
  equipment: true,
  description: `Augmente les dégâts des attaques d'un personnage de ${BOOST_AMOUNT} pendant ${BOOST_DURATION_TURNS} tour`,
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
    // api.attachObject refuse silencieusement (match.ts) et la potion partirait au
    // cimetière après avoir quand même posé le buff.
    const activeAlly = ctx.getActive(ctx.ownerId);
    const candidates = ctx
      .getAllOnBoard(ctx.ownerId)
      .filter((c) => c.attachedObjectInstanceIds.length < getMaxAttachedObjects(ctx.state, c.instanceId))
      // Un banc isolé (Arène) n'est plus équipable, même par son propre camp.
      .filter(
        (c) =>
          c.instanceId === activeAlly?.instanceId ||
          canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow
      );
    if (candidates.length === 0) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Potion force : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    ctx.applyStatus(targetId, {
      statusId: 'atk-boost',
      label: 'Potion force',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: BOOST_DURATION_TURNS,
      // Counts down even if its bearer is benched right after: otherwise a switch froze
      // the buff (bench suspends durations) and it came back intact much later.
      ticksOnBench: true,
      data: { amount: BOOST_AMOUNT, objectInstanceId: ctx.sourceInstanceId },
    });
  },
};
