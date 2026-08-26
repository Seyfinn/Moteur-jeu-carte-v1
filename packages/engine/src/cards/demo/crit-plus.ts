import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const CRIT_THRESHOLD = 2;
const GUARANTEED_CRIT_PERCENT = 70;

export const critPlus: ObjectCardDef = {
  type: 'object',
  id: 'crit-plus',
  name: 'Crit +',
  equipment: true, // se lie au porteur (ctx.attachSelfTo ci-dessous) au lieu d'être consommée
  description: 'Si la carte a réussis à crit 2x, Tout ses crit passent à 70 pourcents de chance\n',
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
    // api.attachObject refuse silencieusement (match.ts) et l'objet partirait au
    // cimetière après avoir quand même posé son compteur.
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
      prompt: 'Crit + : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // 'crit-streak' est un statut générique reconnu par le moteur (comme 'critical') :
    // c'est effect-context.ts::dealDamage qui incrémente `data.count` à chaque critique
    // réussi du porteur, et queries.ts::getCriticalPercent qui garantit `boostPercent`%
    // une fois `threshold` atteint. L'objet ne fait que poser le compteur à 0 -- un objet
    // n'a de toute façon aucun trigger pour réagir lui-même à un critique.
    //
    // Comme Poche de sang : le compteur, une fois posé, est un état permanent du porteur,
    // pas un modifier de l'objet -- détruire Crit + (terrain Destruction...) ne lui retire
    // donc pas sa progression ni un taux déjà garanti.
    ctx.applyStatus(targetId, {
      statusId: 'crit-streak',
      label: `Critiques (0/${CRIT_THRESHOLD})`,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { count: 0, threshold: CRIT_THRESHOLD, boostPercent: GUARANTEED_CRIT_PERCENT },
    });
  },
};
