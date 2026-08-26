import { beforeAll, describe, expect, it } from 'vitest';
import {
  getCurrentHP,
  listDeckPool,
  registerCard,
  validateRoster,
  type CharacterCardDef,
  type Match,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

/**
 * Une capacité qui ne fait qu'évoluer vers une forme donnée -- ce que ferait une vraie
 * carte depuis la passive qui porte sa condition d'évolution.
 */
function evolveAbility(id: string, toCardId: string) {
  return {
    id,
    name: id,
    kind: 'active' as const,
    description: '',
    usableFromBench: true,
    usesPerTurn: Infinity,
    async execute(ctx: Parameters<CharacterCardDef['abilities'][number]['execute']>[0]) {
      await ctx.evolveCharacter(ctx.sourceInstanceId, toCardId);
    },
  };
}

/** Capacité 1×/partie portant le MÊME id sur la base et sur ses formes : piège des compteurs. */
const sharedAbility = {
  id: 'shared-once',
  name: 'Shared Once',
  kind: 'active' as const,
  description: '',
  usesPerGame: 1,
  async execute() {},
};

const fxEvolver: CharacterCardDef = {
  type: 'character',
  id: 'fx-evolver',
  name: 'Fixture Evolver',
  baseMaxHP: 100,
  evolvesTo: ['fx-evolved-big', 'fx-evolved-small'],
  attacks: [
    {
      id: 'strike',
      name: 'Strike',
      baseATK: 10,
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) await ctx.dealDamage(target.instanceId, 10);
      },
    },
  ],
  abilities: [
    sharedAbility,
    evolveAbility('evolve-big', 'fx-evolved-big'),
    evolveAbility('evolve-small', 'fx-evolved-small'),
    // Une forme que la carte ne déclare PAS : le moteur doit refuser.
    evolveAbility('evolve-illegal', 'fx-tank'),
  ],
};

const fxEvolvedBig: CharacterCardDef = {
  type: 'character',
  id: 'fx-evolved-big',
  name: 'Fixture Evolved Big',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'big-strike',
      name: 'Big Strike',
      baseATK: 80,
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) await ctx.dealDamage(target.instanceId, ctx.getEffectiveATK(ctx.sourceInstanceId, 80));
      },
    },
  ],
  abilities: [sharedAbility],
};

const fxEvolvedSmall: CharacterCardDef = {
  type: 'character',
  id: 'fx-evolved-small',
  name: 'Fixture Evolved Small',
  baseMaxHP: 40,
  attacks: [],
  abilities: [],
};

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [fxEvolver, fxEvolvedBig, fxEvolvedSmall]) registerCard(card);
  }
});

const ROSTER: RosterConfig = { characterCardIds: ['fx-evolver', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

describe("Règle 1 -- la réserve d'évolution est masquée", () => {
  it('sort les formes évoluées du pool et les rattache à leur carte de base', () => {
    const pool = listDeckPool();
    const ids = pool.map((e) => e.id);

    expect(ids).toContain('fx-evolver');
    expect(ids).not.toContain('fx-evolved-big');
    expect(ids).not.toContain('fx-evolved-small');

    // ... mais elles restent visibles, accrochées à la base (le point « bonus » du brief).
    const base = pool.find((e) => e.id === 'fx-evolver')!;
    expect(base.evolutions?.map((f) => f.id)).toEqual(['fx-evolved-big', 'fx-evolved-small']);
    expect(base.evolutions?.[0]).toMatchObject({ name: 'Fixture Evolved Big', baseMaxHP: 200 });

    // Une carte ordinaire n'en traîne aucune.
    expect(pool.find((e) => e.id === 'fx-tank')!.evolutions).toEqual([]);
  });

  it("refuse une forme évoluée dans un deck, sans toucher au quota de la base", () => {
    const withForm: RosterConfig = { characterCardIds: ['fx-evolved-big'], objectCardIds: [], terrainCardIds: [] };
    const result = validateRoster(withForm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('forme évoluée');

    expect(validateRoster(ROSTER).ok).toBe(true);
  });
});

describe("Règles 2 et 3 -- remplacement en place et conservation de l'état", () => {
  it('remplace la carte sur le BANC sans déplacer le personnage, statuts et dégâts intacts', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 31 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');
    expect(match.state.players.p1.benchCharacterInstanceIds).toContain(evolverId);

    const self = match.state.players.p1.characters[evolverId]!;
    self.damage = 30;
    self.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 3 });
    self.statuses.push({ statusId: 'atk-boost', label: 'Buff', data: { amount: 25 } });

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-big' });

    const after = match.state.players.p1.characters[evolverId]!;
    expect(after.cardId).toBe('fx-evolved-big');
    // Toujours au banc, toujours la même instance.
    expect(match.state.players.p1.benchCharacterInstanceIds).toContain(evolverId);
    // Dégâts subis conservés, plafond repris sur la nouvelle carte.
    expect(after.damage).toBe(30);
    expect(after.currentMaxHP).toBe(200);
    expect(getCurrentHP(after)).toBe(170);
    // Buffs ET malus conservés intégralement.
    expect(after.statuses.map((s) => s.statusId).sort()).toEqual(['atk-boost', 'poison']);
    // Le nouveau kit est actif immédiatement (et le buff d'ATK s'y applique).
    const { getEffectiveATK } = await import('../src/queries.js');
    expect(getEffectiveATK(match.state, evolverId, 80)).toBe(105);
  });

  it('conserve les modifications de plafond déjà accumulées (règle 1b)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 31 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');

    // +50 de plafond gagnés en cours de partie (type Coeur Acier).
    match.state.players.p1.characters[evolverId]!.currentMaxHP = 150;

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-big' });
    // 200 (nouvelle base) + 50 (acquis) : le buff payé n'est pas perdu.
    expect(match.state.players.p1.characters[evolverId]!.currentMaxHP).toBe(250);
    expect(match.state.players.p1.characters[evolverId]!.baseMaxHP).toBe(200);
  });

  it('garde les objets équipés attachés à la nouvelle forme', async () => {
    const equipped: RosterConfig = {
      characterCardIds: ['fx-evolver', 'fx-tank'],
      objectCardIds: ['fx-mirror-object'],
      terrainCardIds: [],
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: equipped, p2Roster: FOE, seed: 33 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');

    // fx-mirror-object s'accroche à l'actif du possesseur.
    const objectId = Object.values(match.state.players.p1.objects).find((o) => o.cardId === 'fx-mirror-object')!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });
    expect(match.state.players.p1.characters[evolverId]!.attachedObjectInstanceIds).toContain(objectId);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-big' });

    expect(match.state.players.p1.characters[evolverId]!.cardId).toBe('fx-evolved-big');
    expect(match.state.players.p1.characters[evolverId]!.attachedObjectInstanceIds).toContain(objectId);
    expect(match.state.players.p1.objects[objectId]!.attachedToCharacterInstanceId).toBe(evolverId);
  });

  it("remet à zéro les compteurs d'usage, pour qu'une capacité au même id ne naisse pas épuisée", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 35 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'shared-once' });
    // 1×/partie : épuisée sur la carte de base.
    expect(match.applyAction('p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'shared-once' }).ok).toBe(false);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-big' });
    // La forme évoluée porte une capacité du même id : elle doit repartir neuve.
    expect(match.applyAction('p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'shared-once' }).ok).toBe(true);
  });
});

describe('Règle 4 -- cimetière, et garde-fous', () => {
  it("envoie la FORME ÉVOLUÉE au cimetière, la base ne réapparaît pas", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 37 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');
    // 60 dégâts déjà encaissés, puis évolution vers un plafond de 40 : la forme évoluée
    // meurt sur le coup, exactement comme un valeur lock qui passe sous les dégâts subis.
    match.state.players.p1.characters[evolverId]!.damage = 60;

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-small' });

    expect(match.state.players.p1.graveyardCharacterInstanceIds).toContain(evolverId);
    // C'est bien la forme évoluée qui est au cimetière...
    expect(match.state.players.p1.characters[evolverId]!.cardId).toBe('fx-evolved-small');
    // ... et la base n'y a pas été ajoutée séparément.
    const graveyardCardIds = match.state.players.p1.graveyardCharacterInstanceIds.map(
      (id) => match.state.players.p1.characters[id]!.cardId
    );
    expect(graveyardCardIds).not.toContain('fx-evolver');
  });

  it("refuse d'évoluer vers une carte que la base ne déclare pas", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 39 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-illegal' });
    expect(match.state.players.p1.characters[evolverId]!.cardId).toBe('fx-evolver');
  });

  it('laisse la carte choisir sa branche parmi celles déclarées (Kayn)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 41 },
      { p1ActiveCardId: 'fx-evolver', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const evolverId = findInstance(match, 'p1', 'fx-evolver');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: evolverId, abilityId: 'evolve-small' });
    expect(match.state.players.p1.characters[evolverId]!.cardId).toBe('fx-evolved-small');
  });
});
