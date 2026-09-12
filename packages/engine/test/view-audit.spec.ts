import { beforeAll, describe, expect, it } from 'vitest';
import { getPlayerView, registerDemoCards, type Match, type RosterConfig } from '../src/index.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

/**
 * Audit de la vue joueur telle que le serveur l'envoie (`Room.sendStateTo` ne fait rien de
 * plus que `getPlayerView`) : ce que l'adversaire ne doit JAMAIS recevoir, et ce qu'il doit
 * quand même voir (une vue trop caviardée casse le plateau aussi sûrement qu'une fuite).
 * Complète `view-reveal.spec.ts` (réserve adverse, graine) et `engine-audit.spec.ts`
 * (choix en attente, journal des cartes reçues en main).
 */

beforeAll(() => {
  registerDemoCards();
  registerTestFixtures();
});

/** En Mode Pioche les rosters sont ignorés : tout sort des piles. */
const NO_ROSTER: RosterConfig = { characterCardIds: [], objectCardIds: [], terrainCardIds: [] };

function drawMatch(seed: number): Promise<Match> {
  return createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: NO_ROSTER, p2Roster: NO_ROSTER, seed, mode: 'draw' });
}

describe('journal privé (`data.privateTo`)', () => {
  it("une ligne privée n'existe que dans la vue de son destinataire, et le reste du journal est intact des deux côtés", async () => {
    const match = await drawMatch(11);
    const state = match.state;
    const publicBefore = state.log.length;
    state.log.push({ id: 'audit-private', turnNumber: state.turnNumber, message: 'Secret pour p1', data: { privateTo: 'p1', cardId: 'x' } });
    state.log.push({ id: 'audit-public', turnNumber: state.turnNumber, message: 'Pour tous', data: { kind: 'info' } });

    const p1 = getPlayerView(state, 'p1');
    const p2 = getPlayerView(state, 'p2');
    expect(p1.log.map((e) => e.id)).toContain('audit-private');
    expect(p2.log.map((e) => e.id)).not.toContain('audit-private');
    expect(JSON.stringify(p2.log)).not.toContain('Secret pour p1');
    // Le reste passe intégralement : la vue de p2 n'a perdu QUE la ligne privée.
    expect(p2.log).toHaveLength(publicBefore + 1);
    expect(p1.log).toHaveLength(publicBefore + 2);
  });
});

describe('Mode Pioche : mains et piles', () => {
  it("la Main Personnage adverse et l'ordre des piles sont opaques, mais leurs tailles restent lisibles", async () => {
    const match = await drawMatch(12);
    const state = match.state;
    // Au coup d'envoi, tout le monde est posé : on remet un personnage du banc en main,
    // comme le ferait une pioche.
    const drawn = state.players.p1.benchCharacterInstanceIds.pop()!;
    state.players.p1.handCharacterInstanceIds.push(drawn);
    const realHand = state.players.p1.handCharacterInstanceIds;
    expect(realHand.length).toBeGreaterThan(0);

    const p2 = getPlayerView(state, 'p2');
    // Même nombre de cartes (le client affiche « N cartes »), aucune identité.
    expect(p2.players.p1.handCharacterInstanceIds).toHaveLength(realHand.length);
    for (const id of p2.players.p1.handCharacterInstanceIds) {
      expect(id).toMatch(/^hidden-character-/);
      expect(p2.players.p1.characters[id]).toBeUndefined();
    }
    for (const id of realHand) expect(p2.players.p1.characters[id]).toBeUndefined();
    // Les personnages POSÉS de p1 restent publics : actif et banc doivent se résoudre.
    const onBoard = [state.players.p1.activeCharacterInstanceId!, ...state.players.p1.benchCharacterInstanceIds];
    for (const id of onBoard) expect(p2.players.p1.characters[id]).toBeDefined();

    // Les piles : opaques pour l'adversaire ET pour leur propriétaire (lire l'ordre, c'est
    // lire l'avenir), à la bonne taille des deux côtés.
    for (const viewer of ['p1', 'p2'] as const) {
      const view = getPlayerView(state, viewer);
      for (const owner of ['p1', 'p2'] as const) {
        const real = state.players[owner].drawPiles;
        const seen = view.players[owner].drawPiles;
        expect(seen.characterCardIds).toHaveLength(real.characterCardIds.length);
        expect(seen.objectCardIds).toHaveLength(real.objectCardIds.length);
        expect(seen.characterCardIds.every((id) => id.startsWith('hidden-pile-character-'))).toBe(true);
        expect(seen.objectCardIds.every((id) => id.startsWith('hidden-pile-object-'))).toBe(true);
      }
      expect(view.sharedTerrainPile).toHaveLength(state.sharedTerrainPile.length);
      expect(view.sharedTerrainPile.every((id) => id.startsWith('hidden-pile-terrain-'))).toBe(true);
    }
  });

  it("la vue est stable : deux appels sur le même état donnent la même chose (le client compare les états reçus)", async () => {
    const match = await drawMatch(13);
    const a = JSON.stringify(getPlayerView(match.state, 'p2'));
    const b = JSON.stringify(getPlayerView(match.state, 'p2'));
    expect(a).toBe(b);
  });
});

describe('ce qui doit rester visible', () => {
  it("le cimetière adverse et les objets adverses déjà joués (équipés compris) se résolvent dans la vue", async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 14 });
    const state = match.state;
    const p1 = state.players.p1;
    // Un objet de p1 quitte sa main : au cimetière pour l'un, équipé sur son actif pour
    // l'autre. Les deux sont « joués » : l'adversaire doit pouvoir les lire.
    const [buried, equipped] = p1.unplayedObjectInstanceIds;
    expect(buried && equipped).toBeTruthy();
    p1.unplayedObjectInstanceIds = p1.unplayedObjectInstanceIds.filter((id) => id !== buried && id !== equipped);
    p1.graveyardObjectInstanceIds.push(buried!);
    p1.characters[p1.activeCharacterInstanceId!]!.attachedObjectInstanceIds.push(equipped!);

    const p2 = getPlayerView(state, 'p2');
    expect(p2.players.p1.objects[buried!]).toBeDefined();
    expect(p2.players.p1.objects[equipped!]).toBeDefined();
    expect(p2.players.p1.graveyardObjectInstanceIds).toContain(buried);
    // Et ce qui reste en main est toujours opaque.
    for (const id of p2.players.p1.unplayedObjectInstanceIds) expect(p2.players.p1.objects[id]).toBeUndefined();
  });
});
