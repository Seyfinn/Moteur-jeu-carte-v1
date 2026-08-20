import type { AttackDef, CharacterCardDef, EffectContext } from '../types.js';

const KILL_STATUS_ID = 'katarina-kills';

function getKillCount(ctx: EffectContext, instanceId: string): number {
  const status = ctx.getCharacter(instanceId).statuses.find((s) => s.statusId === KILL_STATUS_ID);
  return Number(status?.data?.['count'] ?? 0);
}

function incrementKillCount(ctx: EffectContext, instanceId: string): number {
  const count = getKillCount(ctx, instanceId) + 1;
  ctx.removeStatus(instanceId, KILL_STATUS_ID);
  ctx.applyStatus(instanceId, { statusId: KILL_STATUS_ID, label: `Ennemis tués : ${count}`, data: { count } });
  return count;
}

/**
 * Verocity has no independent trigger of its own -- "attack again on kill"
 * only ever applies to Shunpo (Katarina's only attack), so the re-attack and
 * kill-tracking logic live directly on that attack's execute/endsTurn pair.
 * `killedThisResolution` is a closure flag: match.ts calls execute(ctx) then
 * endsTurn(ctx) back-to-back for the same attack instance, so it's safe as a
 * same-turn handoff and gets reset at the start of every execute.
 */
function shunpo(): AttackDef {
  let killedThisResolution = false;
  return {
    id: 'shunpo',
    name: 'Shunpo',
    baseATK: 70,
    description:
      'Katarina met un coup de dague à l’ennemi. Verocity : si l’ennemi est tué, Katarina peut attaquer de nouveau ce tour.',
    endsTurn() {
      return !killedThisResolution;
    },
    async execute(ctx) {
      killedThisResolution = false;
      const target = ctx.getActive(ctx.opponentId);
      if (!target) return;
      const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, 70);
      await ctx.dealDamage(target.instanceId, atk);
      if (ctx.isKO(target.instanceId)) {
        killedThisResolution = true;
        const kills = incrementKillCount(ctx, ctx.sourceInstanceId);
        ctx.log(`Verocity : Katarina attaque de nouveau (${kills} ennemi(s) tué(s) au total)`, { kills });
      }
    },
  };
}

export const katarina: CharacterCardDef = {
  type: 'character',
  id: 'katarina',
  name: 'Katarina',
  baseMaxHP: 140,
  abilities: [
    {
      id: 'verocity',
      name: 'Verocity',
      kind: 'passive',
      description: 'Katarina peut attaquer de nouveau au même tour si elle tue un ennemi.',
      async execute() {
        // Purely descriptive: the re-attack itself is implemented on Shunpo (see shunpo() above).
      },
    },
    {
      id: 'death-lotus',
      name: 'Death lotus',
      kind: 'active',
      description:
        'Si Katarina a tué 3 ennemis, elle peut utiliser cette compétence. Katarina tourne sur elle-même en jetant des dagues, ce qui inflige 100 dégâts à TOUS les ennemis.',
      condition(ctx) {
        return getKillCount(ctx, ctx.sourceInstanceId) >= 3;
      },
      async execute(ctx) {
        for (const enemy of ctx.getAllOnBoard(ctx.opponentId)) {
          await ctx.dealDamage(enemy.instanceId, 100);
        }
      },
    },
  ],
  attacks: [shunpo()],
};
