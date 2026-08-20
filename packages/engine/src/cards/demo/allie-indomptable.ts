import type { ObjectCardDef } from '../types.js';

export const allieIndomptable: ObjectCardDef = {
  type: 'object',
  id: 'allie-indomptable',
  name: 'Allié indomptable',
  description: "Enlève 10 HP max à toutes vos cartes alliées et donne le total en ATK bonus à une carte choisie.",
  async execute(ctx) {
    const allies = ctx.getAllOnBoard(ctx.ownerId);
    let total = 0;
    for (const ally of allies) {
      await ctx.applyValeurLock(ally.instanceId, 10);
      total += 10;
    }
    if (total === 0) return;

    const survivors = ctx.getAllOnBoard(ctx.ownerId).filter((c) => !ctx.isKO(c.instanceId));
    if (survivors.length === 0) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: `Choisissez la carte qui reçoit +${total} ATK`,
      options: survivors.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    const obj = ctx.getObject(ctx.sourceInstanceId);
    obj.data = { ...(obj.data ?? {}), atkBonus: total };
  },
  modifiers: [
    {
      query: 'getEffectiveATK',
      isActive(mctx) {
        const obj = mctx.state.players[mctx.sourceOwnerId].objects[mctx.sourceInstanceId];
        const targetInstanceId = mctx.query['characterInstanceId'] as string | undefined;
        return obj?.attachedToCharacterInstanceId !== undefined && obj.attachedToCharacterInstanceId === targetInstanceId;
      },
      transform(mctx, current) {
        const obj = mctx.state.players[mctx.sourceOwnerId].objects[mctx.sourceInstanceId];
        const bonus = Number(obj?.data?.['atkBonus'] ?? 0);
        return (current as number) + bonus;
      },
    },
  ],
};
