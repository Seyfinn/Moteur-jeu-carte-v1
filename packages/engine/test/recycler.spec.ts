import { beforeAll, describe, expect, it } from 'vitest';
import {
  RECYCLE_OBJECT_COST,
  buildStandardObjectReserve,
  createRng,
  listDeckPool,
  registerDemoCards,
  type Match,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { randomUUID } from '../src/uuid.js';
import { registerTestFixtures, fxAdrenalineObject, fxHealObject, fxMirrorObject, fxStriker, fxTank } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

/** Six objets en main : de quoi recycler deux fois d'affilée dans le même tour. */
const RECYCLER_ROSTER: RosterConfig = {
  characterCardIds: [fxStriker.id, fxTank.id],
  objectCardIds: [
    fxHealObject.id,
    fxHealObject.id,
    fxMirrorObject.id,
    fxMirrorObject.id,
    fxAdrenalineObject.id,
    fxAdrenalineObject.id,
  ],
  terrainCardIds: [],
};

async function newMatch(seed: number): Promise<Match> {
  return createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: RECYCLER_ROSTER, p2Roster: RECYCLER_ROSTER, seed });
}

/** Les `RECYCLE_OBJECT_COST` premiers objets de la main de `playerId`. */
function firstHandObjects(match: Match, playerId: PlayerId): string[] {
  return match.state.players[playerId].unplayedObjectInstanceIds.slice(0, RECYCLE_OBJECT_COST);
}

describe("Le Recycleur d'Objets", () => {
  it('échange 3 objets de la main contre 1 objet, sans passer par le cimetière', async () => {
    const match = await newMatch(11);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];
    const handBefore = player.unplayedObjectInstanceIds.length;
    const reserveBefore = player.drawPiles.objectCardIds.length;
    const picked = firstHandObjects(match, me);
    const pickedCardIds = picked.map((id) => player.objects[id]!.cardId);

    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: picked });

    const after = match.state.players[me];
    // 3 partent, 1 arrive.
    expect(after.unplayedObjectInstanceIds.length).toBe(handBefore - RECYCLE_OBJECT_COST + 1);
    // La réserve gagne les 3 sacrifiées et rend la carte tirée : +2 net.
    expect(after.drawPiles.objectCardIds.length).toBe(reserveBefore + RECYCLE_OBJECT_COST - 1);
    // Rien au cimetière : les cartes recyclées doivent pouvoir ressortir.
    expect(after.graveyardObjectInstanceIds).toHaveLength(0);
    // Les instances sacrifiées n'existent plus nulle part.
    for (const id of picked) {
      expect(after.objects[id]).toBeUndefined();
      expect(after.unplayedObjectInstanceIds).not.toContain(id);
    }
    // La carte reçue est une vraie instance d'objet, en main.
    const drawnId = after.unplayedObjectInstanceIds.at(-1)!;
    expect(after.objects[drawnId]).toBeDefined();
    expect(after.objects[drawnId]!.ownerId).toBe(me);

    // Les 3 cardIds recyclés sont bien dans la réserve -- sauf celui qu'on vient d'en
    // retirer, le tirage se faisant APRÈS le remélange (on peut retomber sur une des trois).
    const reserve = [...after.drawPiles.objectCardIds];
    for (const cardId of pickedCardIds) {
      const index = reserve.indexOf(cardId);
      if (index !== -1) reserve.splice(index, 1);
      else expect(after.objects[drawnId]!.cardId).toBe(cardId);
    }
  });

  it("ne coûte ni le tour, ni le budget de 2 objets jouables, et n'est pas limité par tour", async () => {
    const match = await newMatch(11);
    const me = match.state.activePlayerId;

    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: firstHandObjects(match, me) });
    expect(match.state.activePlayerId).toBe(me); // le tour continue
    expect(match.state.players[me].objectsPlayedThisTurn).toBe(0); // recycler n'est pas « jouer un objet »

    // Deuxième recyclage dans le MÊME tour : 6 - 3 + 1 = 4 objets en main, donc encore possible.
    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: firstHandObjects(match, me) });
    expect(match.state.activePlayerId).toBe(me);
    expect(match.state.players[me].unplayedObjectInstanceIds).toHaveLength(2);
    expect(match.state.players[me].objectsPlayedThisTurn).toBe(0);

    // Et le budget d'objets jouables est resté entier.
    const remaining = match.state.players[me].unplayedObjectInstanceIds[0]!;
    await drive(match, me, { kind: 'play-object', objectInstanceId: remaining });
    expect(match.state.players[me].objectsPlayedThisTurn).toBe(1);
  });

  it('refuse le recyclage hors de son tour, à moins de 3 objets, ou sur une sélection invalide', async () => {
    const match = await newMatch(11);
    const me = match.state.activePlayerId;
    const opponent: PlayerId = me === 'p1' ? 'p2' : 'p1';

    // Pas son tour.
    expect(
      match.applyAction(opponent, { kind: 'recycle-objects', objectInstanceIds: firstHandObjects(match, opponent) })
    ).toEqual({ ok: false, error: "Ce n'est pas votre tour" });

    // Mauvais nombre de cartes.
    const picked = firstHandObjects(match, me);
    expect(match.applyAction(me, { kind: 'recycle-objects', objectInstanceIds: picked.slice(0, 2) }).ok).toBe(false);

    // Doublons : trois ids, mais deux fois la même carte.
    expect(
      match.applyAction(me, { kind: 'recycle-objects', objectInstanceIds: [picked[0]!, picked[0]!, picked[1]!] })
    ).toEqual({ ok: false, error: 'Doublons dans la sélection' });

    // Une carte qui n'est pas dans la main (celle de l'adversaire).
    const theirs = firstHandObjects(match, opponent);
    expect(
      match.applyAction(me, { kind: 'recycle-objects', objectInstanceIds: [picked[0]!, picked[1]!, theirs[0]!] })
    ).toEqual({ ok: false, error: "Un des objets sélectionnés n'est pas dans votre main" });

    // Main trop courte : on descend à 2 objets, puis il n'y a plus de quoi recycler.
    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: picked });
    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: firstHandObjects(match, me) });
    expect(match.state.players[me].unplayedObjectInstanceIds).toHaveLength(2);
    expect(match.applyAction(me, { kind: 'recycle-objects', objectInstanceIds: [] })).toEqual({
      ok: false,
      error: `Il faut ${RECYCLE_OBJECT_COST} objets en main pour recycler`,
    });
  });

  it("ne révèle à l'adversaire ni les cartes sacrifiées ni celle tirée", async () => {
    const match = await newMatch(11);
    const me = match.state.activePlayerId;
    const opponent: PlayerId = me === 'p1' ? 'p2' : 'p1';

    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: firstHandObjects(match, me) });

    const mine = match.getView(me).log.filter((e) => e.data?.['kind'] === 'recycle');
    const theirs = match.getView(opponent).log.filter((e) => e.data?.['kind'] === 'recycle');
    expect(mine).toHaveLength(2); // le geste public + le détail privé
    expect(theirs).toHaveLength(1); // seulement le geste
    expect(theirs[0]!.data?.['privateTo']).toBeUndefined();
  });
});

describe("La réserve d'objets des modes standard", () => {
  it('part du catalogue complet moins la main déjà servie', () => {
    registerDemoCards();
    const catalogue = listDeckPool().filter((e) => e.type === 'object');
    const total = catalogue.reduce((sum, entry) => sum + entry.maxCopies, 0);
    const hand = [catalogue[0]!.id, catalogue[1]!.id];

    const reserve = buildStandardObjectReserve(createRng(3), hand);
    expect(reserve).toHaveLength(total - hand.length);
    // Un exemplaire de chaque carte servie a été retiré, pas tous.
    expect(reserve.filter((id) => id === catalogue[0]!.id)).toHaveLength(catalogue[0]!.maxCopies - 1);
  });

  it('est bien montée pour les deux joueurs en mode standard', async () => {
    const match = await newMatch(5);
    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      expect(match.state.players[playerId].drawPiles.objectCardIds.length).toBeGreaterThan(0);
      // Personne ne pioche de personnage hors Mode Pioche : cette pile-là reste vide.
      expect(match.state.players[playerId].drawPiles.characterCardIds).toHaveLength(0);
    }
  });
});

describe('Le Recycleur en Mode Pioche', () => {
  it('rend les cartes à la pile de pioche existante et y tire la nouvelle', async () => {
    registerDemoCards();
    const NO_ROSTER: RosterConfig = { characterCardIds: [], objectCardIds: [], terrainCardIds: [] };
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: NO_ROSTER,
      p2Roster: NO_ROSTER,
      seed: 21,
      mode: 'draw',
    });
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // Le Mode Pioche ouvre sans aucun objet en main : on en sert 3 à la main, comme le
    // feraient trois tours de pioche, pour arriver à la situation qui nous intéresse.
    const served = player.drawPiles.objectCardIds.splice(-RECYCLE_OBJECT_COST, RECYCLE_OBJECT_COST);
    for (const cardId of served) {
      const instanceId = randomUUID();
      player.objects[instanceId] = { instanceId, cardId, ownerId: me };
      player.unplayedObjectInstanceIds.push(instanceId);
    }
    const reserveBefore = player.drawPiles.objectCardIds.length;

    await drive(match, me, { kind: 'recycle-objects', objectInstanceIds: [...player.unplayedObjectInstanceIds] });

    const after = match.state.players[me];
    expect(after.unplayedObjectInstanceIds).toHaveLength(1);
    expect(after.drawPiles.objectCardIds.length).toBe(reserveBefore + RECYCLE_OBJECT_COST - 1);
    expect(after.graveyardObjectInstanceIds).toHaveLength(0);
  });
});
