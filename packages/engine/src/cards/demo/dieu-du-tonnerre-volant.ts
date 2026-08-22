import type { ObjectCardDef } from '../types.js';
import { evaluatePermission } from '../../queries.js';

export const dieuDuTonnerreVolant: ObjectCardDef = {
  type: 'object',
  id: 'dieu-du-tonnerre-volant',
  name: 'Dieu du Tonnerre Volant',
  description:
    "Switch gratuitement le personnage actif avec un personnage du banc allié de votre choix, sans mettre fin au tour. Ignore Stun et Chaînes (téléportation), mais reste bloqué si une carte en jeu interdit explicitement tout switch.",
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    const bench = ctx.getBench(ctx.ownerId);
    if (!active || bench.length === 0) return;

    // Bypass Stun/Chaînes (contrôles codés en dur de canSwitchStandard), mais respecte
    // toujours un éventuel modifier explicite d'une carte en jeu bloquant tout switch.
    const permission = evaluatePermission(ctx.state, 'canSwitchStandard', { characterInstanceId: active.instanceId }, true, []);
    if (!permission.allow) {
      ctx.log('Dieu du Tonnerre Volant : switch bloqué par un effet en jeu', { characterInstanceId: active.instanceId });
      return;
    }

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Dieu du Tonnerre Volant : choisissez le personnage du banc à faire entrer en jeu',
      options: bench.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    await ctx.forceSwitch(ctx.ownerId, targetId);
  },
};
