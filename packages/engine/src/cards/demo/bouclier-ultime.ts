import type { TerrainCardDef } from '../types.js';

const SOURCE = 'terrain:bouclier-ultime';

export const bouclierUltime: TerrainCardDef = {
  type: 'terrain',
  id: 'bouclier-ultime',
  name: 'Bouclier Ultime',
  description:
    "Tant que le Terrain est actif, vous ne pouvez pas effectuer de switch. En contrepartie, aucun personnage " +
    "sur le banc allié ne peut être ciblé et le banc est totalement immunisé contre tous les dégâts (abilities, " +
    "objets, terrains, états et attaques).",
  modifiers: [
    // Bloque uniquement le switch standard du possesseur du terrain (comme Stun/Chained) --
    // un switch forcé externe (ex: Hook de Blitzcrank) bypasse canSwitchStandard et reste possible.
    {
      query: 'canSwitchStandard',
      vote(ctx) {
        const player = ctx.state.players[ctx.sourceOwnerId];
        if (player.activeCharacterInstanceId !== ctx.query['characterInstanceId']) return undefined;
        return { allow: false, source: SOURCE };
      },
    },
    // Le banc du possesseur ne peut pas être choisi comme cible (ex: Hook, qui a été adapté pour
    // consulter canTargetBench avant de proposer un perso du banc adverse).
    {
      query: 'canTargetBench',
      vote(ctx) {
        const player = ctx.state.players[ctx.sourceOwnerId];
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return undefined;
        return { allow: false, source: SOURCE };
      },
    },
    // Immunité totale aux dégâts (classiques et valeur lock) pour le banc du possesseur --
    // couvre attaques/abilities/objets/terrains adverses et les ticks de poison/brûlure, qui
    // passent tous par le même point d'entrée api.dealDamage.
    // NB: n'immunise pas contre l'application d'un statut lui-même (ex: un stun posé directement
    // sur un perso du banc) -- le moteur n'a pas de hook pour bloquer applyStatus aujourd'hui.
    {
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        const player = ctx.state.players[ctx.sourceOwnerId];
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return current;
        return 0;
      },
    },
    {
      query: 'getIncomingValeurLockAmount',
      transform(ctx, current) {
        const player = ctx.state.players[ctx.sourceOwnerId];
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return current;
        return 0;
      },
    },
  ],
};
