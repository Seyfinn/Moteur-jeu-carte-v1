import type { CharacterCardDef } from '../types.js';

const HEADSHOT_DAMAGE = 125;
const BASE_CRIT_PERCENT = 33;
const EXECUTION_CRIT_PERCENT = 50;

export const caitlyn: CharacterCardDef = {
  type: 'character',
  id: 'caitlyn',
  name: 'Caitlyn',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'headshot',
      name: 'Headshot',
      baseATK: HEADSHOT_DAMAGE,
      description: `Inflige ${HEADSHOT_DAMAGE} dégâts à l'actif adverse. Peut critiquer : ${BASE_CRIT_PERCENT}% de base grâce à "Execution", ${EXECUTION_CRIT_PERCENT}% dès que Caitlyn a tué un ennemi (pour le reste de la partie).`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Applique la chance de critique innée de "Execution" au premier
        // Headshot (pas de trigger 'onGameStart' fiable dans le moteur, voir
        // la description de l'ability -- init paresseuse ici, sans effet
        // observable puisque le crit de Caitlyn n'est jamais consulté ailleurs).
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (!self.statuses.some((s) => s.statusId === 'critical')) {
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: 'critical',
            label: 'Critique (Execution)',
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { percent: BASE_CRIT_PERCENT },
          });
        }

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, HEADSHOT_DAMAGE);
        await ctx.dealDamage(target.instanceId, atk);

        if (ctx.isKO(target.instanceId)) {
          ctx.removeStatus(ctx.sourceInstanceId, 'critical');
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: 'critical',
            label: 'Critique (Execution)',
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { percent: EXECUTION_CRIT_PERCENT },
          });
          ctx.log(`Execution se déclenche : Caitlyn passe à ${EXECUTION_CRIT_PERCENT}% de critique pour le reste de la partie`, {
            characterInstanceId: ctx.sourceInstanceId,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'execution',
      name: 'Execution',
      kind: 'passive',
      description: `Caitlyn a une chance de critique innée de ${BASE_CRIT_PERCENT}% sur ses attaques. Si elle tue un ennemi, cette chance passe à ${EXECUTION_CRIT_PERCENT}% pour le reste de la partie. Purement descriptif ici : implémenté directement dans "Headshot" plutôt que via un trigger, car le moteur n'émet ni event fiable pour "début de partie" ni information sur qui a causé un kill (cf CLAUDE.md).`,
      // Pas de trigger : le mécanisme vit entièrement dans l'attaque, cf description ci-dessus.
      async execute() {},
    },
  ],
};
