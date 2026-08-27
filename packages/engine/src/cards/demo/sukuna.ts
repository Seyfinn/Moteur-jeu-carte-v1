import type { CharacterCardDef } from '../types.js';

const LACERATION_ATK = 55;
const BLEED_STACKS = 2;
const REGEN_AMOUNT = 30;
const TERRITORY_BONUS = 20;
const AUTEL_DEMONIAQUE_CARD_ID = 'autel-demoniaque';

export const sukuna: CharacterCardDef = {
  type: 'character',
  id: 'sukuna',
  name: 'Sukuna',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'laceration',
      name: 'Lacération',
      baseATK: LACERATION_ATK,
      description: `Inflige ${LACERATION_ATK} dégâts à l'actif adverse et applique ${BLEED_STACKS} stacks de bleed.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Un seul jet d'esquive partagé entre les dégâts et le bleed (même pattern
        // que "La flamme" de Rengoku) : soit l'attaque touche et les deux
        // s'appliquent, soit elle est esquivée et rien ne se passe.
        if (ctx.rollEvasion(target.instanceId)) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, LACERATION_ATK);
        await ctx.dealDamage(target.instanceId, atk, { skipEvasionRoll: true });
        ctx.applyStatus(
          target.instanceId,
          {
            statusId: 'bleed',
            label: 'Bleed (Lacération)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { stacks: BLEED_STACKS },
          },
          { skipEvasionRoll: true }
        );
      },
    },
  ],
  abilities: [
    {
      id: 'sort-inverse',
      name: 'Sort Inversé',
      kind: 'passive',
      description: `À la fin de ton tour, la carte récupère ${REGEN_AMOUNT} PV si elle est sur le poste actif.`,
      trigger: 'onTurnEnd',
      condition(ctx) {
        return ctx.event?.playerId === ctx.ownerId;
      },
      async execute(ctx) {
        ctx.heal(ctx.sourceInstanceId, REGEN_AMOUNT);
      },
    },
    {
      id: 'extension-de-territoire',
      name: 'Extention de territoire',
      kind: 'passive',
      description: `Tant que la carte Terrain Autel Démoniaque est en jeu (jouée par vous ou l'adversaire), les attaques de Sukuna gagnent +${TERRITORY_BONUS} dégâts.`,
      // Purement descriptif : implémenté via le modifier getEffectiveATK ci-dessous --
      // condition dynamique dépendant du plateau (qui peut changer à tout moment sur
      // les deux camps), pas un statut à poser/retirer sur un trigger.
      async execute() {},
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        const characterInstanceId = ctx.query['characterInstanceId'] as string;
        if (characterInstanceId !== ctx.sourceInstanceId) return current;
        const autelInPlay = (['p1', 'p2'] as const).some((playerId) => {
          const player = ctx.state.players[playerId];
          const terrainId = player.activeTerrainInstanceId;
          return terrainId ? player.terrains[terrainId]?.cardId === AUTEL_DEMONIAQUE_CARD_ID : false;
        });
        return autelInPlay ? (current as number) + TERRITORY_BONUS : current;
      },
    },
  ],
};
