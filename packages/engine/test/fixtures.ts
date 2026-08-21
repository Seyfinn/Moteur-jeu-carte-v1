import { registerCard, type CharacterCardDef, type ObjectCardDef, type RosterConfig, type TerrainCardDef } from '../src/index.js';
import { findCharacter } from '../src/queries.js';

const fxStriker: CharacterCardDef = {
  type: 'character',
  id: 'fx-striker',
  name: 'Fixture Striker',
  baseMaxHP: 100,
  abilities: [],
  attacks: [
    {
      id: 'strike',
      name: 'Strike',
      baseATK: 40,
      description: 'Deals 40 to the opponent active.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, ctx.getEffectiveATK(ctx.sourceInstanceId, 40));
      },
    },
    {
      id: 'no-end-strike',
      name: 'No-End Strike',
      baseATK: 10,
      description: 'Deals 10 and never ends the turn (test-only override attack).',
      endsTurn: false,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, 10);
      },
    },
  ],
};

const fxTank: CharacterCardDef = {
  type: 'character',
  id: 'fx-tank',
  name: 'Fixture Tank',
  baseMaxHP: 300,
  abilities: [],
  attacks: [
    {
      id: 'poke',
      name: 'Poke',
      baseATK: 10,
      description: 'Deals 10 to the opponent active.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, 10);
      },
    },
  ],
};

const fxStunner: CharacterCardDef = {
  type: 'character',
  id: 'fx-stunner',
  name: 'Fixture Stunner',
  baseMaxHP: 100,
  attacks: [
    {
      id: 'jab',
      name: 'Jab',
      baseATK: 5,
      description: 'Deals 5 to the opponent active.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, 5);
      },
    },
  ],
  abilities: [
    {
      id: 'stun-enemy',
      name: 'Stun Enemy',
      kind: 'active',
      usesPerTurn: 1,
      description: 'Applies stun to the opponent active for 1 turn.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        ctx.applyStatus(target.instanceId, { statusId: 'stun', label: 'Stun', remainingTurns: 1 });
      },
    },
  ],
};

const fxGlass: CharacterCardDef = {
  type: 'character',
  id: 'fx-glass',
  name: 'Fixture Glass',
  baseMaxHP: 10,
  abilities: [],
  attacks: [
    {
      id: 'shatter',
      name: 'Shatter',
      baseATK: 10,
      description: 'Deals 10 to the opponent active -- enough to KO another fx-glass in one hit.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.dealDamage(target.instanceId, 10);
      },
    },
  ],
};

const fxHealObject: ObjectCardDef = {
  type: 'object',
  id: 'fx-heal-object',
  name: 'Fixture Heal Object',
  description: 'Heals the owner active by 15, then goes to the graveyard.',
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (active) ctx.heal(active.instanceId, 15);
  },
};

const fxAuraTerrain: TerrainCardDef = {
  type: 'terrain',
  id: 'fx-aura-terrain',
  name: 'Fixture Aura Terrain',
  description: 'No mechanical effect; used to exercise play/replace/graveyard cycling.',
};

/** Test-only mirror of the "Hôpital" demo card: doubles heals landing on its owner's own characters. */
const fxHealAuraTerrain: TerrainCardDef = {
  type: 'terrain',
  id: 'fx-heal-aura-terrain',
  name: 'Fixture Heal Aura Terrain',
  description: "Doubles healing received by its owner's characters.",
  modifiers: [
    {
      query: 'getIncomingHealAmount',
      transform(ctx, current) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId !== ctx.sourceOwnerId) return current;
        return (current as number) * 2;
      },
    },
  ],
};

let registered = false;

export function registerTestFixtures(): void {
  if (registered) return;
  registered = true;
  registerCard(fxStriker);
  registerCard(fxTank);
  registerCard(fxStunner);
  registerCard(fxGlass);
  registerCard(fxHealObject);
  registerCard(fxAuraTerrain);
  registerCard(fxHealAuraTerrain);
}

export const FX_ROSTER: RosterConfig = {
  characterCardIds: [fxStriker.id, fxTank.id, fxStunner.id],
  objectCardIds: [fxHealObject.id, fxHealObject.id],
  terrainCardIds: [fxAuraTerrain.id, fxHealAuraTerrain.id],
};

/** Two 10-HP one-shot-able characters per side -- cheap to fully wipe out for KO/win-condition tests. */
export const TINY_ROSTER: RosterConfig = {
  characterCardIds: [fxGlass.id, fxGlass.id],
  objectCardIds: [],
  terrainCardIds: [],
};

export { fxStriker, fxTank, fxStunner, fxGlass, fxHealObject, fxAuraTerrain };
