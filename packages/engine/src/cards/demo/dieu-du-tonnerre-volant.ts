import type { ObjectCardDef } from '../types.js';
import { describeDenials, evaluatePermission } from '../../queries.js';
import { hasStatus } from '../../statuses.js';

export const dieuDuTonnerreVolant: ObjectCardDef = {
  type: 'object',
  id: 'dieu-du-tonnerre-volant',
  name: 'Dieu du Tonnerre Volant',
  description:
    'Téléportation : échange votre actif avec un personnage de votre banc, gratuitement et sans finir votre tour. Ignore Stun.',
  // Refusée avant d'être consommée dans tous les cas où la téléportation n'aurait pas lieu :
  // le Stun est bien ignoré (il n'apparaît pas ici), mais Chaînes bloque tout switch et un
  // interdit explicite d'une carte en jeu (Bouclier Ultime) aussi.
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    if (player.benchCharacterInstanceIds.length === 0) return "aucun personnage sur votre banc";
    const activeId = player.activeCharacterInstanceId;
    if (!activeId) return 'aucun personnage actif à téléporter';
    const active = player.characters[activeId];
    if (active && hasStatus(active, 'chained')) return 'votre personnage actif est enchaîné';
    const permission = evaluatePermission(state, 'canSwitchStandard', { characterInstanceId: activeId }, true, []);
    if (!permission.allow) return `switch bloqué (${describeDenials(permission.votes)})`;
    return null;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    const bench = ctx.getBench(ctx.ownerId);
    if (!active || bench.length === 0) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Dieu du Tonnerre Volant : choisissez le personnage du banc à faire entrer en jeu',
      options: bench.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    // zones.switchActive refuse de lui-même un actif enchaîné ou explicitement bloqué --
    // unplayableReason ci-dessus a déjà écarté ces cas au moment de jouer la carte.
    await ctx.forceSwitch(ctx.ownerId, targetId);
  },
};
