import { registerCard, type CharacterCardDef, type ObjectCardDef, type RosterConfig, type TerrainCardDef } from '../src/index.js';
import { findCharacter } from '../src/queries.js';
import { getCharacterCard } from '../src/cards/registry.js';

const fxStriker: CharacterCardDef = {
  type: 'character',
  id: 'fx-striker',
  name: 'Fixture Striker',
  baseMaxHP: 100,
  abilities: [
    {
      id: 'instant-ko',
      name: 'Instant KO',
      kind: 'active',
      description: "Test-only mirror of Akali's Perfect Execution primitive: kills the enemy active outright via ctx.koCharacter, bypassing the damage pipeline entirely.",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        await ctx.koCharacter(target.instanceId);
      },
    },
  ],
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
  abilities: [
    {
      id: 'self-buff',
      name: 'Self Buff',
      kind: 'active',
      description:
        'Test-only: applies a +40 atk-boost to whoever executes it (the ctx source). Used to verify "steal an ability and re-execute it with a different source" mechanics.',
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, { statusId: 'atk-boost', label: 'Self Buff', data: { amount: 40 }, remainingTurns: 5 });
      },
    },
  ],
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

/** Test-only mirror of the "Métamorphe" demo card: copies the enemy active's cardId, re-pointing its whole kit. */
const fxTransformer: CharacterCardDef = {
  type: 'character',
  id: 'fx-transformer',
  name: 'Fixture Transformer',
  baseMaxHP: 60,
  abilities: [
    {
      id: 'transform',
      name: 'Transform',
      kind: 'active',
      description: "Copies the enemy active's cardId; HP ceiling moves to the copied card's baseMaxHP via raiseMaxHP/applyValeurLock.",
      usesPerGame: 1,
      async execute(ctx) {
        const enemyActive = ctx.getActive(ctx.opponentId);
        if (!enemyActive) return;
        const targetCardId = enemyActive.cardId;
        const targetDef = getCharacterCard(targetCardId);

        const self = ctx.getCharacter(ctx.sourceInstanceId);
        self.cardId = targetCardId;

        const delta = targetDef.baseMaxHP - self.currentMaxHP;
        if (delta > 0) ctx.raiseMaxHP(ctx.sourceInstanceId, delta);
        else if (delta < 0) await ctx.applyValeurLock(ctx.sourceInstanceId, -delta);
      },
    },
  ],
  attacks: [],
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

/** Test-only mirror of the "Miroir de Renvoi" demo card: attaches to the owner active, reflects a percentage of the next hit back to the attacker, then self-destroys. */
const fxMirrorObject: ObjectCardDef = {
  type: 'object',
  id: 'fx-mirror-object',
  name: 'Fixture Mirror Object',
  description: 'Attaches to the owner active; reflects 50% of the next hit back to the attacker, then self-destroys.',
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.attachSelfTo(active.instanceId);
    ctx.applyStatus(active.instanceId, {
      statusId: 'miroir-de-renvoi',
      label: 'Fixture Mirror',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { percent: 50, objectInstanceId: ctx.sourceInstanceId },
    });
  },
};

/** Test-only mirror of "Adrénaline Ultime": requires >=150 current HP to play, drops it to 10, doubles this turn's (getEffectiveATK-routed) attack damage. */
const fxAdrenalineObject: ObjectCardDef = {
  type: 'object',
  id: 'fx-adrenaline-object',
  name: 'Fixture Adrenaline Object',
  description: 'Requires the owner active to have >=150 HP; drops it to 10 and doubles its attack damage this turn.',
  condition(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return false;
    return active.currentMaxHP - active.damage >= 150;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    const currentHP = active.currentMaxHP - active.damage;
    const toLose = currentHP - 10;
    if (toLose > 0) await ctx.dealDamage(active.instanceId, toLose);
    ctx.applyStatus(active.instanceId, {
      statusId: 'atk-multiplier',
      label: 'Fixture Adrenaline',
      data: { multiplier: 2 },
      remainingTurns: 1,
    });
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

/** Test-only mirror of the "Brise bouclier" demo card: enemy generic shield stops absorbing damage. */
const fxShieldNullifierTerrain: TerrainCardDef = {
  type: 'terrain',
  id: 'fx-shield-nullifier-terrain',
  name: 'Fixture Shield Nullifier Terrain',
  description: "The enemy's generic shield no longer absorbs damage while this is in play.",
  modifiers: [
    {
      query: 'canShieldAbsorb',
      vote(ctx) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId === ctx.sourceOwnerId) return undefined;
        return { allow: false, source: 'terrain:fx-shield-nullifier' };
      },
    },
  ],
};

/** Test-only mirror of the "Point faible" demo card: raises its owner's crit multiplier from x2 to x3. */
const fxCritBoostTerrain: TerrainCardDef = {
  type: 'terrain',
  id: 'fx-crit-boost-terrain',
  name: 'Fixture Crit Boost Terrain',
  description: "Critical hits from this terrain's owner deal 3x instead of 2x.",
  modifiers: [
    {
      query: 'getCriticalMultiplier',
      transform(ctx, current) {
        const characterInstanceId = ctx.query['characterInstanceId'] as string;
        const attacker = findCharacter(ctx.state, characterInstanceId);
        if (attacker.ownerId !== ctx.sourceOwnerId) return current;
        return 3;
      },
    },
  ],
};

/** Test-only mirror of Muzan's "Sang Maudit": while active, poison on enemy characters (any source) ticks as valeur lock instead of ordinary damage -- rechecked every tick, never affects its own side. */
const fxPoisonCurse: CharacterCardDef = {
  type: 'character',
  id: 'fx-poison-curse',
  name: 'Fixture Poison Curse',
  baseMaxHP: 200,
  abilities: [],
  attacks: [],
  modifiers: [
    {
      query: 'poisonTicksAsValeurLock',
      isActive(ctx) {
        return ctx.state.players[ctx.sourceOwnerId].activeCharacterInstanceId === ctx.sourceInstanceId;
      },
      vote(ctx) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId === ctx.sourceOwnerId) return undefined;
        return { allow: true, source: 'fx-poison-curse' };
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
  registerCard(fxShieldNullifierTerrain);
  registerCard(fxCritBoostTerrain);
  registerCard(fxTransformer);
  registerCard(fxPoisonCurse);
  registerCard(fxMirrorObject);
  registerCard(fxAdrenalineObject);
}

export const FX_ROSTER: RosterConfig = {
  characterCardIds: [fxStriker.id, fxTank.id, fxStunner.id],
  objectCardIds: [fxHealObject.id, fxHealObject.id],
  terrainCardIds: [fxAuraTerrain.id, fxHealAuraTerrain.id, fxCritBoostTerrain.id, fxShieldNullifierTerrain.id],
};

/** Two 10-HP one-shot-able characters per side -- cheap to fully wipe out for KO/win-condition tests. */
export const TINY_ROSTER: RosterConfig = {
  characterCardIds: [fxGlass.id, fxGlass.id],
  objectCardIds: [],
  terrainCardIds: [],
};

/** Single-character roster for a fixture that transforms into whatever it faces. */
export const TRANSFORMER_ROSTER: RosterConfig = {
  characterCardIds: [fxTransformer.id],
  objectCardIds: [],
  terrainCardIds: [],
};

/** Poison-curse fixture on p1 slot 1, a plain tank as its own bench-mate on slot 2 -- lets tests pick which side is active. */
export const POISON_CURSE_ROSTER: RosterConfig = {
  characterCardIds: [fxPoisonCurse.id, fxTank.id],
  objectCardIds: [],
  terrainCardIds: [],
};

/** fxStriker/fxTank plus the mirror object in the unplayed pool -- lets tests play it and immediately attack back and forth. */
export const MIRROR_ROSTER: RosterConfig = {
  characterCardIds: [fxStriker.id, fxTank.id],
  objectCardIds: [fxMirrorObject.id],
  terrainCardIds: [],
};

/** fxStriker/fxTank plus the adrenaline object in the unplayed pool. */
export const ADRENALINE_ROSTER: RosterConfig = {
  characterCardIds: [fxStriker.id, fxTank.id],
  objectCardIds: [fxAdrenalineObject.id],
  terrainCardIds: [],
};

export {
  fxStriker,
  fxTank,
  fxStunner,
  fxGlass,
  fxTransformer,
  fxPoisonCurse,
  fxMirrorObject,
  fxAdrenalineObject,
  fxHealObject,
  fxAuraTerrain,
};
