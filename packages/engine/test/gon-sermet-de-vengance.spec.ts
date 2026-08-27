import { beforeAll, describe, expect, it } from 'vitest';
import { getPlayerView, registerCard, type EngineApi, type Match, type PlayerId, type RosterConfig } from '../src/index.js';
import { gon } from '../src/cards/demo/gon.js';
import { gonAdulte } from '../src/cards/demo/gon-adulte.js';
import { getCurrentHP } from '../src/hp.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive, settle } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [gon, gonAdulte]) registerCard(card);
  }
});

const ROSTER: RosterConfig = { characterCardIds: [gon.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-striker'], objectCardIds: [], terrainCardIds: [] };

const TARGET_RECORD_STATUS_ID = 'gon-cible-record';
const TARGET_REVEALED_STATUS_ID = 'gon-cible';

function gonInstance(match: Match) {
  const found = Object.values(match.state.players.p1.characters).find((c) => c.cardId === gon.id || c.cardId === gonAdulte.id);
  if (!found) throw new Error('no Gon on the board');
  return found;
}

function designatedTargetId(match: Match): string {
  const record = gonInstance(match).statuses.find((s) => s.statusId === TARGET_RECORD_STATUS_ID);
  return String(record?.data?.['targetInstanceId']);
}

async function passUntilTurn(match: Match, turnNumber: number): Promise<void> {
  let guard = 0;
  while (match.state.turnNumber < turnNumber) {
    if (++guard > 60) throw new Error('passUntilTurn: match never reached that turn');
    await drive(match, match.state.activePlayerId as PlayerId, { kind: 'pass' });
  }
}

describe('Gon -- "Sermet de Vengance" : la Cible secrète tirée au sort à onGameStart', () => {
  it('tire la Cible sans rien demander, la dit au camp de Gon et la cache à l\'adversaire', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 11 },
      { p1ActiveCardId: gon.id, p2ActiveCardId: 'fx-tank' }
    );

    // Personne n'a rien eu à désigner : la mise en place n'a posé aucune question de plus.
    expect(match.state.phase).toBe('main');
    expect(match.state.pendingChoice).toBeUndefined();

    const targetId = designatedTargetId(match);
    expect(match.state.players.p2.characters[targetId]).toBeDefined();

    // Pas de badge sur la Cible : rien ne la distingue sur le plateau avant le tour 10.
    const target = match.state.players.p2.characters[targetId]!;
    expect(target.statuses.some((s) => s.statusId === TARGET_REVEALED_STATUS_ID)).toBe(false);
    // Le porte-mémoire, lui, est caché : pas de badge chez Gon non plus.
    expect(gonInstance(match).statuses.find((s) => s.statusId === TARGET_RECORD_STATUS_ID)?.hidden).toBe(true);

    // La ligne qui nomme la Cible n'existe que dans la vue du camp de Gon.
    const namesTarget = (state: { log: { data?: Record<string, unknown> }[] }) =>
      state.log.some((e) => e.data?.['characterInstanceId'] === targetId);
    expect(namesTarget(getPlayerView(match.state, 'p1'))).toBe(true);
    expect(namesTarget(getPlayerView(match.state, 'p2'))).toBe(false);
  });

  it('ne tire jamais deux fois la même Cible quelle que soit la graine (le tirage suit la RNG)', async () => {
    const picks = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const match = await createReadyMatch(
        { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed },
        { p1ActiveCardId: gon.id, p2ActiveCardId: 'fx-tank' }
      );
      const targetId = designatedTargetId(match);
      const isActive = targetId === match.state.players.p2.activeCharacterInstanceId;
      picks.add(isActive ? 'actif' : 'banc');
    }
    // Le tirage porte bien sur tout le camp adverse, pas seulement sur son actif.
    expect(picks.size).toBe(2);
  });

  it('révèle la Cible à partir du tour 10', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 12 },
      { p1ActiveCardId: gon.id, p2ActiveCardId: 'fx-tank' }
    );
    const targetId = designatedTargetId(match);

    await passUntilTurn(match, 10);
    await settle(match);

    const target = match.state.players.p2.characters[targetId]!;
    expect(target.statuses.some((s) => s.statusId === TARGET_REVEALED_STATUS_ID)).toBe(true);
    expect(match.state.log.some((e) => e.data?.['characterInstanceId'] === targetId)).toBe(true);
  });

  it("fait évoluer Gon et le soigne à fond quand la Cible meurt, quelle qu'en soit la cause", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 13 },
      { p1ActiveCardId: gon.id, p2ActiveCardId: 'fx-tank' }
    );

    // Cible ramenée sur le BANC adverse : son KO ne demande pas de remplaçant, alors
    // qu'un KO au poste actif ouvrirait une fenêtre que rien n'est là pour répondre ici
    // (le KO est déclenché hors du cycle d'action du Match).
    const record = gonInstance(match).statuses.find((s) => s.statusId === TARGET_RECORD_STATUS_ID)!;
    const benchedId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    record.data = { ...record.data, targetInstanceId: benchedId };
    const targetId = designatedTargetId(match);
    expect(targetId).toBe(benchedId);

    const gonId = gonInstance(match).instanceId;
    match.state.players.p1.characters[gonId]!.damage = 50; // 30/80 avant l'évolution

    // Mort sans aucun rapport avec Gon : c'est le moteur qui exécute la Cible.
    const api = match['api'] as EngineApi;
    await api.koCharacter(targetId);
    await settle(match);

    const evolved = match.state.players.p1.characters[gonId]!;
    expect(evolved.cardId).toBe(gonAdulte.id);
    expect(evolved.currentMaxHP).toBe(300);
    expect(getCurrentHP(evolved)).toBe(300); // « soigne tous ses PV »
    // La mémoire de la Cible est nettoyée : la forme évoluée ne la relit jamais.
    expect(evolved.statuses.some((s) => s.statusId === TARGET_RECORD_STATUS_ID)).toBe(false);
  });
});
