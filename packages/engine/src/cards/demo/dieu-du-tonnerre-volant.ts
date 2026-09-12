import type { ObjectCardDef } from '../types.js';
import type { GameState, PlayerId } from '../../types.js';
import { canSwitchAny, describeDenials } from '../../queries.js';
import { hasStatus } from '../../statuses.js';

/**
 * Les personnages du banc que la téléportation peut réellement faire entrer. Le garde est
 * celui de `zones.switchActive`, l'unique point de passage des switchs forcés : `canSwitchAny`
 * (Arène ferme tout, le scellement de Chrollo refuse UNE carte précise à l'entrée). Le
 * Stun, lui, n'est pas consulté -- il ne ferme que l'action de switch standard, que cette
 * carte contourne justement.
 */
function enterableBench(state: GameState, ownerId: PlayerId): string[] {
  const player = state.players[ownerId];
  const activeId = player.activeCharacterInstanceId;
  return player.benchCharacterInstanceIds.filter((id) => canSwitchAny(state, ownerId, activeId, id).allow);
}

export const dieuDuTonnerreVolant: ObjectCardDef = {
  type: 'object',
  id: 'dieu-du-tonnerre-volant',
  name: 'Dieu du Tonnerre Volant',
  description:
    'Permet de switch le personnage actif avec un personnage du banc allié, gratuitement, sans mettre fin au tour.',
  // Refusée avant d'être consommée dans tous les cas où la téléportation n'aurait pas lieu :
  // le Stun est bien ignoré (il n'apparaît pas ici), mais Chaînes bloque tout switch et un
  // interdit explicite d'une carte en jeu (Arène, scellement de Chrollo) aussi -- exactement
  // les refus que `zones.switchActive` opposerait ensuite au `forceSwitch`, en silence.
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    if (player.benchCharacterInstanceIds.length === 0) return "aucun personnage sur votre banc";
    const activeId = player.activeCharacterInstanceId;
    if (!activeId) return 'aucun personnage actif à téléporter';
    const active = player.characters[activeId];
    if (active && hasStatus(active, 'chained')) return 'votre personnage actif est enchaîné';
    if (enterableBench(state, ownerId).length === 0) {
      const permission = canSwitchAny(state, ownerId, activeId, player.benchCharacterInstanceIds[0]!);
      return `switch bloqué (${describeDenials(permission.votes)})`;
    }
    return null;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    // Seuls les personnages que le switch laisserait entrer sont proposés : en désigner un
    // autre ferait renoncer `zones.switchActive` en silence et gaspillerait la carte.
    const bench = ctx.getBench(ctx.ownerId).filter((c) => enterableBench(ctx.state, ctx.ownerId).includes(c.instanceId));
    if (bench.length === 0) return;

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
