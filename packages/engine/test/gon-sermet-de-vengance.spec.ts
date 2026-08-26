import { beforeAll, describe, expect, it } from 'vitest';
import { Match as MatchClass, registerCard, type EngineApi, type Match, type PendingChoice, type PlayerId, type RosterConfig } from '../src/index.js';
import { gon } from '../src/cards/demo/gon.js';
import { gonAdulte } from '../src/cards/demo/gon-adulte.js';
import { getCurrentHP } from '../src/hp.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, settle } from './test-utils.js';

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

describe('Gon -- "Sermet de Vengance" : la Cible secrète désignée à onGameStart', () => {
  it('pose sa question pendant la mise en place sans bloquer la partie, et garde la Cible invisible', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 11 },
      { p1ActiveCardId: gon.id, p2ActiveCardId: 'fx-tank' }
    );

    // La mise en place est bien allée jusqu'au bout malgré un prompt émis depuis onGameStart.
    expect(match.state.phase).toBe('main');
    expect(match.state.pendingChoice).toBeUndefined();

    const targetId = designatedTargetId(match);
    expect(match.state.players.p2.characters[targetId]).toBeDefined();

    // Secret : ni badge sur la Cible, ni ligne de journal qui la nomme (le journal est
    // commun aux deux joueurs, la moindre entrée vendrait la mèche).
    const target = match.state.players.p2.characters[targetId]!;
    expect(target.statuses.some((s) => s.statusId === TARGET_REVEALED_STATUS_ID)).toBe(false);
    expect(match.state.log.some((e) => e.data?.['characterInstanceId'] === targetId)).toBe(false);
    // Le porte-mémoire, lui, est caché : pas de badge chez Gon non plus.
    expect(gonInstance(match).statuses.find((s) => s.statusId === TARGET_RECORD_STATUS_ID)?.hidden).toBe(true);
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
    // Mise en place à la main : on veut une Cible sur le BANC adverse, dont le KO ne
    // demande pas de remplaçant -- sinon la fenêtre de remplacement reste sans réponse.
    const match = MatchClass.create({ p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 13 });
    await settle(match, (choice: PendingChoice, m: Match) => {
      if (choice.spec.kind !== 'select-characters') return defaultAnswer(choice);
      const asker = m.state.players[choice.playerId];
      const options = choice.spec.options;
      if (options.every((id) => asker.characters[id])) {
        // Choix de l'actif de départ : les options appartiennent au joueur interrogé.
        const wanted = choice.playerId === 'p1' ? gon.id : 'fx-tank';
        const found = options.find((id) => asker.characters[id]!.cardId === wanted);
        return { kind: 'select-characters', selected: [found ?? options[0]!] };
      }
      // Sinon c'est la désignation de Gon : on vise le banc adverse.
      const activeId = m.state.players.p2.activeCharacterInstanceId;
      const benched = options.find((id) => id !== activeId);
      return { kind: 'select-characters', selected: [benched ?? options[0]!] };
    });

    const targetId = designatedTargetId(match);
    expect(targetId).not.toBe(match.state.players.p2.activeCharacterInstanceId);

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
