import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type CharacterCardDef, type Match, type PlayerId, type RosterConfig } from '../src/index.js';
import { MAY_CRIT_PERCENT, hitActive, mayCritAttack, readCounter, writeCounter } from '../src/cards/demo/shared.js';
import { getCurrentHP } from '../src/hp.js';
import { getStatus, hasStatus } from '../src/statuses.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

/**
 * Les helpers de `cards/demo/shared.ts` que le scaffold `npm run new-card` génère par
 * défaut : `hitActive` (le squelette de toute attaque « X dégâts + effet »), `mayCritAttack`
 * (la convention « peut crit ») et `readCounter` / `writeCounter` (le compteur persistant).
 * Une carte écrite à partir du stub s'appuie dessus sans les relire : ils doivent donc être
 * prouvés une fois pour toutes ici.
 */

const HIT_ATK = 40;
const COUNTER_ID = 'fx-helper-counter';

/** Personnage de test qui n'utilise QUE les helpers -- comme le ferait un stub du scaffold. */
const fxHelperUser: CharacterCardDef = {
  type: 'character',
  id: 'fx-helper-user',
  name: 'Fixture Helper User',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'helper-hit',
      name: 'Helper Hit',
      baseATK: HIT_ATK,
      description: 'Test-only: hitActive + writeCounter, then logs the id hitActive returned.',
      async execute(ctx) {
        const targetId = await hitActive(ctx, HIT_ATK);
        ctx.log('helper-hit', { kind: 'fx-helper-hit', targetId: targetId ?? null });
        writeCounter(ctx, ctx.sourceInstanceId, {
          statusId: COUNTER_ID,
          label: 'Hits',
          count: readCounter(ctx, ctx.sourceInstanceId, COUNTER_ID) + 1,
        });
      },
    },
    mayCritAttack('helper-crit-default', 'Helper Crit', HIT_ATK, 'Cette attaque peut crit'),
    mayCritAttack('helper-crit-always', 'Helper Crit 100', HIT_ATK, 'Cette attaque peut crit', 100),
    mayCritAttack('helper-crit-never', 'Helper Crit 0', HIT_ATK, 'Cette attaque peut crit', 0),
  ],
  abilities: [
    {
      id: 'mark-enemy',
      name: 'Mark Enemy',
      kind: 'active',
      usesPerTurn: Infinity,
      description: 'Test-only: writes a VISIBLE counter on the enemy active (no evasion roll expected).',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        writeCounter(ctx, target.instanceId, {
          statusId: COUNTER_ID,
          label: 'Marks',
          count: readCounter(ctx, target.instanceId, COUNTER_ID) + 1,
          hidden: false,
        });
      },
    },
    {
      id: 'read-ghost',
      name: 'Read Ghost',
      kind: 'active',
      usesPerTurn: Infinity,
      description: 'Test-only: readCounter on an instance id that does not exist must be 0, not a throw.',
      async execute(ctx) {
        ctx.log('read-ghost', { kind: 'fx-read-ghost', value: readCounter(ctx, 'nobody-here', COUNTER_ID) });
      },
    },
  ],
};

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    registerCard(fxHelperUser);
  }
});

const ROSTER: RosterConfig = { characterCardIds: [fxHelperUser.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };
const EVASIVE_FOE: RosterConfig = { characterCardIds: ['fx-untouchable', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

async function setup(seed: number, foe: RosterConfig = FOE) {
  const match = await createReadyMatch(
    { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: foe, seed },
    { p1ActiveCardId: fxHelperUser.id, p2ActiveCardId: foe.characterCardIds[0] }
  );
  await ensureTurn(match, 'p1');
  const userId = findInstance(match, 'p1', fxHelperUser.id);
  const foeId = match.state.players.p2.activeCharacterInstanceId!;
  return { match, userId, foeId };
}

/** Coupe le 1 % d'esquive de base et les 5 % de critique : la cible encaisse exactement l'ATK. */
function neutralizeDice(match: Match, foeId: string): void {
  match.state.players.p2.characters[foeId]!.statuses.push({ statusId: 'evasion-locked', label: 'no-dodge', remainingTurns: 99 });
}

describe('hitActive -- frapper l\'actif adverse pour l\'ATK effectif', () => {
  it("inflige l'ATK effectif à l'actif adverse et renvoie son instanceId", async () => {
    const { match, userId, foeId } = await setup(1);
    neutralizeDice(match, foeId);
    const before = getCurrentHP(match.state.players.p2.characters[foeId]!);

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });

    const after = getCurrentHP(match.state.players.p2.characters[foeId]!);
    const lost = before - after;
    // 40 en temps normal, 80 sur les 5 % de critique de base : jamais 0, jamais autre chose.
    expect([HIT_ATK, HIT_ATK * 2]).toContain(lost);
    const entry = [...match.state.log].reverse().find((e) => e.data?.['kind'] === 'fx-helper-hit');
    expect(entry?.data?.['targetId']).toBe(foeId);
  });

  it("passe par getEffectiveATK : un atk-boost sur l'attaquant s'ajoute", async () => {
    const { match, userId, foeId } = await setup(2);
    neutralizeDice(match, foeId);
    match.state.players.p1.characters[userId]!.statuses.push({ statusId: 'atk-boost', label: 'boost', data: { amount: 25 } });
    const before = getCurrentHP(match.state.players.p2.characters[foeId]!);

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });

    const lost = before - getCurrentHP(match.state.players.p2.characters[foeId]!);
    expect([HIT_ATK + 25, (HIT_ATK + 25) * 2]).toContain(lost);
  });

  it("renvoie undefined et ne fait rien quand il n'y a pas d'actif en face", async () => {
    const { match, userId, foeId } = await setup(3);
    // Situation artificielle (le moteur remplace toujours un KO), mais c'est le contrat du
    // helper : sans cible, pas de coup, pas d'exception -- et le reste de l'attaque continue.
    match.state.players.p2.activeCharacterInstanceId = null;
    const foeBefore = match.state.players.p2.characters[foeId]!.damage;

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });

    expect(match.state.players.p2.characters[foeId]!.damage).toBe(foeBefore);
    const entry = [...match.state.log].reverse().find((e) => e.data?.['kind'] === 'fx-helper-hit');
    expect(entry?.data?.['targetId']).toBeNull();
    // Le compteur écrit après le coup a quand même été posé.
    expect(getStatus(match.state.players.p1.characters[userId]!, COUNTER_ID)?.data?.['count']).toBe(1);
  });
});

describe('mayCritAttack -- la convention « peut crit »', () => {
  it('vaut 33 % par défaut, posé comme `critical` + data.percent le temps du coup, puis retiré', async () => {
    expect(MAY_CRIT_PERCENT).toBe(33);
    // Le seed fixe le sort de chaque coup : sur une vingtaine de parties, au moins une crit
    // (déterministe, pas de hasard entre deux lancers de la suite), et CHAQUE critique
    // annoncé porte le taux de la convention -- jamais les 5 % de base.
    const percents: unknown[] = [];
    for (let seed = 20; seed < 40; seed++) {
      const { match, userId, foeId } = await setup(seed);
      neutralizeDice(match, foeId);
      await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-crit-default' });
      // Le statut ne survit pas à l'attaque : la carte ne « garde » pas son crit relevé.
      expect(hasStatus(match.state.players.p1.characters[userId]!, 'critical')).toBe(false);
      for (const e of match.state.log) if (e.data?.['kind'] === 'critical') percents.push(e.data['percent']);
    }
    expect(percents.length).toBeGreaterThan(0);
    expect(new Set(percents)).toEqual(new Set([MAY_CRIT_PERCENT]));
  });

  it('à 100 % : le coup est toujours critique (x2) et le statut est retiré ensuite', async () => {
    const { match, userId, foeId } = await setup(5);
    neutralizeDice(match, foeId);
    const before = getCurrentHP(match.state.players.p2.characters[foeId]!);

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-crit-always' });

    expect(before - getCurrentHP(match.state.players.p2.characters[foeId]!)).toBe(HIT_ATK * 2);
    expect(match.state.log.some((e) => e.data?.['kind'] === 'critical')).toBe(true);
    expect(hasStatus(match.state.players.p1.characters[userId]!, 'critical')).toBe(false);
  });

  it('à 0 % : jamais de critique, même pas les 5 % de base', async () => {
    const { match, userId, foeId } = await setup(6);
    neutralizeDice(match, foeId);
    const before = getCurrentHP(match.state.players.p2.characters[foeId]!);

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-crit-never' });

    expect(before - getCurrentHP(match.state.players.p2.characters[foeId]!)).toBe(HIT_ATK);
    expect(match.state.log.some((e) => e.data?.['kind'] === 'critical')).toBe(false);
  });

  it("laisse intact un `critical` que l'attaquant portait déjà (ni écrasé, ni retiré)", async () => {
    const { match, userId, foeId } = await setup(7);
    neutralizeDice(match, foeId);
    match.state.players.p1.characters[userId]!.statuses.push({
      statusId: 'critical',
      label: 'Venu d\'ailleurs',
      data: { percent: 100 },
      remainingTurns: 3,
    });

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-crit-never' });

    const kept = getStatus(match.state.players.p1.characters[userId]!, 'critical');
    expect(kept?.label).toBe('Venu d\'ailleurs');
    expect(kept?.data?.['percent']).toBe(100);
    // Et c'est SON taux qui a joué : le 0 % de l'attaque n'a pas écrasé le 100 % déjà porté.
    expect(match.state.log.some((e) => e.data?.['kind'] === 'critical')).toBe(true);
  });
});

describe('readCounter / writeCounter -- le compteur persistant', () => {
  it("vaut 0 sans statut, s'incrémente sans dupliquer le statut, et n'a pas de durée", async () => {
    const { match, userId, foeId } = await setup(8);
    neutralizeDice(match, foeId);
    expect(getStatus(match.state.players.p1.characters[userId]!, COUNTER_ID)).toBeUndefined();

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });
    await ensureTurn(match, 'p1');
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });

    const self = match.state.players.p1.characters[userId]!;
    const instances = self.statuses.filter((s) => s.statusId === COUNTER_ID);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.data?.['count']).toBe(2);
    expect(instances[0]!.remainingTurns).toBeUndefined();
    // Un compteur est de la plomberie : caché par défaut (pas de badge, pas de journal).
    expect(instances[0]!.hidden).toBe(true);
    expect(instances[0]!.sourceCardInstanceId).toBe(userId);
  });

  it('survit aux débuts de tour (jamais décompté par tickStatusesAtTurnStart)', async () => {
    const { match, userId, foeId } = await setup(9);
    neutralizeDice(match, foeId);
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: userId, attackId: 'helper-hit' });
    for (let i = 0; i < 6; i++) await drive(match, match.state.activePlayerId, { kind: 'pass' });
    expect(getStatus(match.state.players.p1.characters[userId]!, COUNTER_ID)?.data?.['count']).toBe(1);
  });

  it("`hidden: false` rend le compteur visible, et il se pose sur un adversaire sans jet d'esquive", async () => {
    // fx-untouchable esquive à 100 % : sans `skipEvasionRoll`, la marque serait « esquivée ».
    const { match, userId, foeId } = await setup(10, EVASIVE_FOE);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: userId, abilityId: 'mark-enemy' });
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: userId, abilityId: 'mark-enemy' });

    const mark = getStatus(match.state.players.p2.characters[foeId]!, COUNTER_ID);
    expect(mark?.data?.['count']).toBe(2);
    expect(mark?.hidden).toBe(false);
    expect(match.state.log.some((e) => e.data?.['kind'] === 'evasion')).toBe(false);
  });

  it('readCounter sur un instanceId inconnu renvoie 0 au lieu de lever', async () => {
    const { match, userId } = await setup(11);
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: userId, abilityId: 'read-ghost' });
    const entry = [...match.state.log].reverse().find((e) => e.data?.['kind'] === 'fx-read-ghost');
    expect(entry?.data?.['value']).toBe(0);
  });
});
