import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type EngineApi, type Match, type PendingChoice, type PlayerId, type RosterConfig } from '../src/index.js';
import { getEffectiveATK } from '../src/queries.js';
import { guts } from '../src/cards/demo/guts.js';
import { blitzcrank } from '../src/cards/demo/blitzcrank.js';
import { chrolloLucilfer } from '../src/cards/demo/chrollo-lucilfer.js';
import { kakashi } from '../src/cards/demo/kakashi.js';
import { kayn } from '../src/cards/demo/kayn.js';
import { kaynAssassin } from '../src/cards/demo/kayn-assassin.js';
import { rhaast } from '../src/cards/demo/rhaast.js';
import { aki } from '../src/cards/demo/aki.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [blitzcrank, chrolloLucilfer, kakashi, kayn, kaynAssassin, rhaast, aki, guts]) registerCard(card);
  }
});

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

function hasStatusId(match: Match, playerId: PlayerId, instanceId: string, statusId: string): boolean {
  return match.state.players[playerId].characters[instanceId]!.statuses.some((s) => s.statusId === statusId);
}

describe('Blitzcrank -- Mana Barrier verrouille Hook « pendant 2 tours »', () => {
  const ROSTER: RosterConfig = { characterCardIds: [blitzcrank.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('Hook reste verrouillé pendant DEUX tours de Blitzcrank, pas un seul', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 11 },
      { p1ActiveCardId: blitzcrank.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p2');
    const blitzId = findInstance(match, 'p1', blitzcrank.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    // 52 PV : le jab (5) le fait passer sous la barre des 50.
    match.state.players.p1.characters[blitzId]!.damage = 198;
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'jab' });
    expect(hasStatusId(match, 'p1', blitzId, 'blitzcrank-mana-barrier-shield')).toBe(true);
    expect(hasStatusId(match, 'p1', blitzId, 'blitzcrank-hook-locked')).toBe(true);

    // Tour 1 de Blitzcrank après le déclenchement : verrouillé.
    expect(match.state.activePlayerId).toBe('p1');
    expect(hasStatusId(match, 'p1', blitzId, 'blitzcrank-hook-locked')).toBe(true);
    expect(match.applyAction('p1', { kind: 'use-ability', characterInstanceId: blitzId, abilityId: 'hook' }).ok).toBe(false);

    // Tour 2 : toujours verrouillé (« pendant 2 tours »).
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(hasStatusId(match, 'p1', blitzId, 'blitzcrank-hook-locked')).toBe(true);
    expect(match.applyAction('p1', { kind: 'use-ability', characterInstanceId: blitzId, abilityId: 'hook' }).ok).toBe(false);

    // Tour 3 : libéré.
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(hasStatusId(match, 'p1', blitzId, 'blitzcrank-hook-locked')).toBe(false);
  });
});

describe('Chrollo Lucilfer -- le livre se referme quand la victime meurt', () => {
  const ROSTER: RosterConfig = { characterCardIds: [chrolloLucilfer.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
  // Trois personnages en face : il en faut encore un au banc pour ouvrir le second livre.
  const FOE3: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner', 'fx-glass'], objectCardIds: [], terrainCardIds: [] };

  it("rend la Dague de Ben et permet d'ouvrir un nouveau livre complet", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE3, seed: 23 },
      { p1ActiveCardId: chrolloLucilfer.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p1');
    const chrolloId = findInstance(match, 'p1', chrolloLucilfer.id);
    const victimId = match.state.players.p2.activeCharacterInstanceId!; // fx-stunner (jab, 5 ATK)

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'double-face-annulation' });
    expect(match.state.players.p2.benchCharacterInstanceIds).toContain(victimId);

    // La victime scellée meurt au banc (brûlure sur 1 PV, tic au début du tour de p2).
    const victim = match.state.players.p2.characters[victimId]!;
    victim.damage = victim.currentMaxHP - 1;
    victim.statuses.push({ statusId: 'burn', label: 'test', remainingTurns: 1 });
    await drive(match, 'p1', { kind: 'pass' });
    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(victimId);
    await drive(match, 'p2', { kind: 'pass' });

    // Chrollo frappe de nouveau avec sa Dague (45), pas avec le jab volé (5).
    const foeActive = match.state.players.p2.activeCharacterInstanceId!; // fx-tank (poke, 10 ATK)
    const damageBefore = match.state.players.p2.characters[foeActive]!.damage;
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: chrolloId, attackId: 'dague-de-ben' });
    expect(match.state.players.p2.characters[foeActive]!.damage - damageBefore).toBe(45);
    await drive(match, 'p2', { kind: 'pass' });

    // Un second livre s'ouvre sur fx-tank : attaque ET actif volés doivent être les siens.
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'double-face-annulation' });
    expect(match.state.players.p2.characters[foeActive]!.statuses.some((s) => s.statusId === 'chrollo-scellement')).toBe(true);
    // « Actif volé » (self-buff de fx-tank) est activable...
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'actif-vole' });
    expect(hasStatusId(match, 'p1', chrolloId, 'atk-boost')).toBe(true);
    // ... et l'attaque volée est bien le poke (10 + 40 du self-buff = 50), pas le jab du mort.
    const newFoe = match.state.players.p2.activeCharacterInstanceId!;
    const before2 = match.state.players.p2.characters[newFoe]!.damage;
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: chrolloId, attackId: 'dague-de-ben' });
    expect(match.state.players.p2.characters[newFoe]!.damage - before2).toBe(10);
  });
});

describe('Kakashi -- Copie de Technique face à une attaque empruntée', () => {
  const ROSTER: RosterConfig = { characterCardIds: [kakashi.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("rejoue l'attaque empruntée (Livre de Chrollo) au lieu de gaspiller son unique utilisation", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 5 },
      { p1ActiveCardId: kakashi.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p2');
    const kakashiId = findInstance(match, 'p1', kakashi.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    // fx-stunner emprunte le poke de fx-tank (10 ATK), comme le ferait Livre de Chrollo.
    match.state.players.p2.characters[foeId]!.statuses.push({
      statusId: 'borrowed-attack',
      label: 'test',
      remainingTurns: 5,
      data: { cardId: 'fx-tank', attackId: 'poke' },
    });
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'poke' });
    expect(match.state.players.p1.characters[kakashiId]!.damage).toBe(10);

    const damageBefore = match.state.players.p2.characters[foeId]!.damage;
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: kakashiId, abilityId: 'copie-de-technique' });
    expect(match.state.players.p2.characters[foeId]!.damage - damageBefore).toBe(10);
  });
});

describe('Kayn -- la Faux volée ne transforme pas son voleur', () => {
  const ROSTER: RosterConfig = { characterCardIds: [chrolloLucilfer.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
  const KAYN_SIDE: RosterConfig = { characterCardIds: [kayn.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('ne pose pas la question de la voie au joueur de Chrollo après 3 coups', async () => {
    const prompts: string[] = [];
    const record = (choice: PendingChoice) => {
      prompts.push(choice.spec.prompt);
      return defaultAnswer(choice);
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: KAYN_SIDE, seed: 7 },
      { p1ActiveCardId: chrolloLucilfer.id, p2ActiveCardId: kayn.id }
    );
    await ensureTurn(match, 'p1');
    const chrolloId = findInstance(match, 'p1', chrolloLucilfer.id);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'double-face-annulation' }, record);
    for (let i = 0; i < 3; i += 1) {
      await drive(match, 'p1', { kind: 'attack', characterInstanceId: chrolloId, attackId: 'dague-de-ben' }, record);
      await drive(match, 'p2', { kind: 'pass' }, record);
    }
    expect(prompts.filter((p) => p.includes('Darkin'))).toEqual([]);
    expect(match.state.players.p1.characters[chrolloId]!.cardId).toBe(chrolloLucilfer.id);
  });
});

describe('Aki -- « Aki va stun au prochain tour »', () => {
  const ROSTER: RosterConfig = { characterCardIds: [aki.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("laisse l'ennemi finir son tour en cours et le stunne pendant le suivant seulement", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    await drive(match, 'p2', { kind: 'use-ability', characterInstanceId: foeId, abilityId: 'self-buff' });
    // Le tour en cours n'est pas coupé : l'ennemi peut encore attaquer.
    const damageBefore = match.state.players.p1.characters[akiId]!.damage;
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'poke' });
    expect(match.state.players.p1.characters[akiId]!.damage).toBeGreaterThan(damageBefore);
    expect(match.state.activePlayerId).toBe('p1');

    // Tour suivant de l'ennemi : stunné.
    await drive(match, 'p1', { kind: 'pass' });
    expect(match.state.activePlayerId).toBe('p2');
    expect(hasStatusId(match, 'p2', foeId, 'stun')).toBe(true);
    expect(match.applyAction('p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'poke' }).ok).toBe(false);

    // Et plus après.
    await drive(match, 'p2', { kind: 'pass' });
    await drive(match, 'p1', { kind: 'pass' });
    expect(hasStatusId(match, 'p2', foeId, 'stun')).toBe(false);
  });
});

describe('Guts -- Berserk compte le CUMUL des PV perdus, pas le record de dégâts', () => {
  const ROSTER: RosterConfig = { characterCardIds: [guts.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('90 subis, 90 soignés, 90 subis = 180 perdus = 1 palier (+50 ATK)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 5 },
      { p1ActiveCardId: guts.id, p2ActiveCardId: 'fx-stunner' }
    );
    const gutsId = findInstance(match, 'p1', guts.id);
    const atk = () => getEffectiveATK(match.state, gutsId, 50);
    expect(atk()).toBe(50);

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(match.state.players.p2.activeCharacterInstanceId!, 'p2', undefined, 'ability');
    await ctx.dealDamage(gutsId, 90, { skipEvasionRoll: true });
    expect(atk()).toBe(50);
    ctx.heal(gutsId, 90);
    await ctx.dealDamage(gutsId, 90, { skipEvasionRoll: true });
    // Record de dégâts : 90 → 0 palier. Cumul : 180 → 1 palier.
    expect(atk()).toBe(100);
  });
});
