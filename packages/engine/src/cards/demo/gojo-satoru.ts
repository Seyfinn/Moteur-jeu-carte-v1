import type { CharacterCardDef } from '../types.js';

const BLACKFLASH_ATK = 55;
const BLACKFLASH_CRIT_PERCENT = 33;

// Ciblé sur l'ennemi pendant le tour de Gojo -> +1 (même correction que le Silence
// Ultime de Zoé, voir zoe.ts : le premier tick du statut a lieu au tout début du tour
// suivant, celui de la cible, donc remainingTurns doit dépasser de 1 le nombre de
// tours à bloquer réellement pour survivre jusque-là).
const STUN_EFFECTIVE_TURNS = 1;
const STUN_REMAINING_TURNS = STUN_EFFECTIVE_TURNS + 1;

export const gojoSatoru: CharacterCardDef = {
  type: 'character',
  id: 'gojo-satoru',
  name: 'Gojo Satoru',
  baseMaxHP: 190,
  attacks: [
    {
      id: 'blackflash',
      name: 'Blackflash',
      baseATK: BLACKFLASH_ATK,
      description: `Inflige ${BLACKFLASH_ATK} dégâts à l'actif adverse. ${BLACKFLASH_CRIT_PERCENT}% de chance de critique (au lieu des 2% de base).`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Applique la chance de critique élevée dès le premier Blackflash (pas de
        // trigger 'onGameStart' fiable dans le moteur -- init paresseuse ici, comme
        // "Execution" de Caitlyn, voir CLAUDE.md).
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (!self.statuses.some((s) => s.statusId === 'critical')) {
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: 'critical',
            label: 'Critique (Blackflash)',
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { percent: BLACKFLASH_CRIT_PERCENT },
          });
        }

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BLACKFLASH_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'infini',
      name: "L'Infini",
      kind: 'passive',
      description:
        "Gojo bénéficie en permanence de l'effet Esquive (statut 'evasive', 33% au lieu de 5% de base), que Gojo soit actif ou au banc.",
      trigger: 'onTurnStart',
      // Doit rester déclenchable même si Gojo est au banc, puisque l'effet doit
      // s'appliquer indépendamment de sa position (voir description).
      usableFromBench: true,
      condition(ctx) {
        return ctx.event?.playerId === ctx.ownerId;
      },
      async execute(ctx) {
        // Pas de trigger 'onGameStart' fiable dans le moteur (voir CLAUDE.md) --
        // applique le statut au tout premier tour du possesseur si absent, puis ne
        // fait plus rien (le statut, sans remainingTurns, ne s'efface jamais tout
        // seul via tickStatusesAtTurnStart).
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (self.statuses.some((s) => s.statusId === 'evasive')) return;
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'evasive',
          label: "Esquive (L'Infini)",
          sourceCardInstanceId: ctx.sourceInstanceId,
        });
      },
    },
    {
      id: 'extension-du-territoire',
      name: 'Extension du Territoire',
      kind: 'active',
      description: `Inflige Stun au personnage actif adverse pendant son prochain tour. Utilisable une seule fois par partie.`,
      usesPerGame: 1,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        ctx.applyStatus(target.instanceId, {
          statusId: 'stun',
          label: 'Stun (Extension du Territoire)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: STUN_REMAINING_TURNS,
        });
      },
    },
  ],
};
