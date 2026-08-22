import type { TerrainCardDef } from '../types.js';
import { getCharacterCard } from '../registry.js';

const DURATION_EFFECTIVE_TURNS = 3;
// +1 : même correction que katarina.ts/sion.ts/ornn.ts -- onTurnStart est émis AVANT
// le tick qui décrémente remainingTurns (turn.ts::startTurn), donc pour détecter "3
// tours du possesseur viennent de s'écouler" il faut guetter remainingTurns === 1
// (pas 0), ce qui nécessite un durationTurns de base supérieur de 1 à l'effet voulu.
const DURATION_TURNS = DURATION_EFFECTIVE_TURNS + 1;

export const absorptionVitale: TerrainCardDef = {
  type: 'terrain',
  id: 'absorption-vitale',
  name: 'Absorption Vitale',
  description:
    `Pendant ${DURATION_EFFECTIVE_TURNS} tours, empêche votre personnage actif du moment de la pose de switch et d'utiliser ses abilities (actives et passives). S'il est toujours actif et vivant à l'issue des ${DURATION_EFFECTIVE_TURNS} tours, il meurt et vous choisissez un personnage de votre cimetière à ranimer sur votre banc avec la moitié de ses HP max. S'il meurt ou est forcé hors du poste actif avant la fin, ce terrain part au cimetière sans effet.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'absorption-vitale-onplay',
      name: 'Absorption Vitale',
      kind: 'passive',
      description: "Verrouille le personnage actif à la pose (chained + silence-ultimate, sans limite de durée propre -- levés par le suivi ci-dessous).",
      trigger: 'onTerrainPlayed',
      async execute(ctx) {
        const active = ctx.getActive(ctx.ownerId);
        const terrain = ctx.getTerrain(ctx.sourceInstanceId);
        if (!active) {
          terrain.data = { trackedCharacterId: undefined };
          return;
        }
        terrain.data = { trackedCharacterId: active.instanceId };
        ctx.applyStatus(active.instanceId, { statusId: 'chained', label: 'Absorption Vitale' });
        ctx.applyStatus(active.instanceId, { statusId: 'silence-ultimate', label: 'Absorption Vitale' });
      },
    },
    {
      id: 'absorption-vitale-tick',
      name: 'Absorption Vitale',
      kind: 'passive',
      description: 'Vérifie chaque tour que le personnage verrouillé est toujours actif et vivant ; au bout de 3 tours, résout la mort + résurrection.',
      trigger: 'onTurnStart',
      condition(ctx) {
        return ctx.event?.playerId === ctx.ownerId;
      },
      async execute(ctx) {
        const terrain = ctx.getTerrain(ctx.sourceInstanceId);
        const trackedId = (terrain.data?.['trackedCharacterId'] as string | undefined) ?? undefined;
        const player = ctx.state.players[ctx.ownerId];

        if (!trackedId || player.activeCharacterInstanceId !== trackedId) {
          // Mort prématurée ou déplacé hors de l'actif par un effet externe : sans effet.
          if (trackedId) {
            ctx.removeStatus(trackedId, 'chained');
            ctx.removeStatus(trackedId, 'silence-ultimate');
          }
          const remaining = terrain.remainingTurns ?? 0;
          if (remaining > 0) await ctx.shortenTerrain(ctx.sourceInstanceId, remaining);
          return;
        }

        if (terrain.remainingTurns !== 1) return; // les 3 tours ne sont pas encore écoulés

        ctx.removeStatus(trackedId, 'chained');
        ctx.removeStatus(trackedId, 'silence-ultimate');
        await ctx.koCharacter(trackedId);

        const graveyard = ctx.state.players[ctx.ownerId].graveyardCharacterInstanceIds;
        if (graveyard.length === 0) return;
        const options = graveyard.map((id) => ({
          key: id,
          name: getCharacterCard(ctx.getCharacter(id).cardId).name,
        }));
        const chosenId = await ctx.chooseOption(
          'Absorption Vitale : choisissez le personnage à ranimer sur votre banc',
          options.map((o) => ({ key: o.key, label: o.name }))
        );
        const chosenChar = ctx.getCharacter(chosenId);
        const reviveHP = Math.floor(chosenChar.currentMaxHP / 2);
        await ctx.reviveCharacter(chosenId, reviveHP, 'bench');
      },
    },
  ],
};
