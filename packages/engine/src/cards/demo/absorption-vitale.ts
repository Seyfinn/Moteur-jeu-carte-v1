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
    `Votre personnage actif est scellé : pendant ${DURATION_EFFECTIVE_TURNS} tours il ne peut ni switcher ni utiliser ses capacités (il peut toujours attaquer). S'il tient jusqu'au bout, il meurt et vous ranimez sur votre banc, à la moitié de ses HP max, un autre personnage de votre cimetière (jamais celui qui vient d'être sacrifié). S'il meurt ou quitte le poste actif avant la fin, le terrain part au cimetière sans rien donner.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'absorption-vitale-onplay',
      name: 'Absorption Vitale',
      kind: 'passive',
      description: "Scelle le personnage actif au moment de la pose.",
      trigger: 'onTerrainPlayed',
      // Only for THIS terrain's own arrival. Without the guard, the event emitted when
      // *any* terrain hits the table (including the opponent's) re-fired this on-play
      // effect for every terrain already in play.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
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
      description: `Vérifie à chaque tour que le personnage scellé est toujours actif et vivant ; au bout de ${DURATION_EFFECTIVE_TURNS} tours, déclenche le sacrifice et la résurrection.`,
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

        // Le personnage qu'on vient de sacrifier est exclu : le ranimer lui-même reviendrait
        // à annuler le coût de la carte (il repart simplement au banc à mi-PV).
        const graveyard = ctx.state.players[ctx.ownerId].graveyardCharacterInstanceIds.filter((id) => id !== trackedId);
        if (graveyard.length === 0) return;
        // `card` : la modale affiche l'illustration réelle plutôt qu'une ligne de texte.
        const options = graveyard.map((id) => {
          const cardId = ctx.getCharacter(id).cardId;
          return { key: id, label: getCharacterCard(cardId).name, card: { cardId, kind: 'character' as const } };
        });
        const chosenId = await ctx.chooseOption(
          'Absorption Vitale : choisissez le personnage à ranimer sur votre banc',
          options
        );
        const chosenChar = ctx.getCharacter(chosenId);
        const reviveHP = Math.floor(chosenChar.currentMaxHP / 2);
        await ctx.reviveCharacter(chosenId, reviveHP, 'bench');
      },
    },
    {
      id: 'absorption-vitale-cleanup',
      name: 'Absorption Vitale',
      kind: 'passive',
      description: 'Libère le personnage scellé si ce terrain quitte le jeu avant la fin.',
      trigger: 'onTerrainRemoved',
      // The lock is deliberately open-ended (no remainingTurns of its own) because the
      // tick above is what lifts it. If the terrain leaves play some other way -- an
      // Annulation de territoire, or simply posing another terrain over it -- that tick
      // never runs again and the character stayed chained + silenced for the whole game.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const trackedId = ctx.getTerrain(ctx.sourceInstanceId).data?.['trackedCharacterId'] as string | undefined;
        if (!trackedId) return;
        ctx.removeStatus(trackedId, 'chained');
        ctx.removeStatus(trackedId, 'silence-ultimate');
      },
    },
  ],
};
