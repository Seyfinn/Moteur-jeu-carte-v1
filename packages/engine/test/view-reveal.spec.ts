import { beforeAll, describe, expect, it } from 'vitest';
import { getPlayerView } from '../src/view.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';
import { Match } from '../src/index.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Ultimate Détective" mechanism (revealsOpponentUnplayedCards flag on getPlayerView) -- through the engine', () => {
  it("by default, the opponent's unplayed objects/terrains are redacted behind placeholder ids", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 98 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p2ObjectIds = match.state.players.p2.unplayedObjectInstanceIds;
    expect(p2ObjectIds.length).toBeGreaterThan(0);

    const p1View = getPlayerView(match.state, 'p1');
    expect(p1View.players.p2.unplayedObjectInstanceIds).not.toEqual(p2ObjectIds);
    for (const id of p2ObjectIds) {
      expect(p1View.players.p2.objects[id]).toBeUndefined();
    }
  });

  it("Kirigiri's 'Ultimate Détective' flag makes the opponent's unplayed pool fully visible from then on", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 99 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p2ObjectIds = match.state.players.p2.unplayedObjectInstanceIds;
    match.state.players.p1.revealsOpponentUnplayedCards = true;

    const p1View = getPlayerView(match.state, 'p1');
    expect(p1View.players.p2.unplayedObjectInstanceIds).toEqual(p2ObjectIds);
    for (const id of p2ObjectIds) {
      expect(p1View.players.p2.objects[id]).toBeDefined();
    }

    // Only p1's own view is affected -- p2 still doesn't see p1's hidden pool.
    const p2View = getPlayerView(match.state, 'p2');
    const p1ObjectIds = match.state.players.p1.unplayedObjectInstanceIds;
    expect(p2View.players.p1.unplayedObjectInstanceIds).not.toEqual(p1ObjectIds);
  });
});

describe("la graine du generateur aleatoire ne quitte jamais le serveur", () => {
  it("est remplacee par une graine morte dans la vue des DEUX joueurs", async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: FX_ROSTER,
      p2Roster: FX_ROSTER,
      seed: 4242,
    });
    // Le PRNG est deterministe : connaitre `seed`, c'est connaitre tous les tirages a
    // venir de la partie (critiques, esquives, jets de pourcentage, pile ou face, carte
    // rendue par le Recycleur). Un joueur n'a qu'a lire l'etat recu pour savoir si sa
    // prochaine attaque passe -- la vue doit donc en etre depourvue.
    const realSeed = match.state.rng.seed;
    for (const playerId of ['p1', 'p2'] as const) {
      expect(getPlayerView(match.state, playerId).rng.seed).not.toBe(realSeed);
    }
  });

  it("reste identique d'un envoi a l'autre tant que rien ne bouge", () => {
    // Une graine tiree au hasard a chaque vue ferait re-rendre le client pour rien.
    const match = Match.create({ p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 7 });
    expect(getPlayerView(match.state, 'p1').rng).toEqual(getPlayerView(match.state, 'p1').rng);
  });
});
