import { beforeAll, describe, expect, it } from 'vitest';
import { DECK_LIMITS, DEMO_STARTER_DECK, listDeckPool, registerDemoCards, validateRoster } from '../src/index.js';
import type { RosterConfig } from '../src/index.js';

beforeAll(() => {
  registerDemoCards();
});

function roster(partial: Partial<RosterConfig>): RosterConfig {
  return { characterCardIds: ['gojo-satoru'], objectCardIds: [], terrainCardIds: [], ...partial };
}

/**
 * Règles de construction de deck. Elles ne vivent pas dans une carte mais dans le moteur
 * (`deck.ts`), et le serveur les applique à l'entrée d'un salon : une régression ici
 * n'apparaîtrait qu'au moment où un joueur n'arrive plus à lancer sa partie.
 */
describe('deck-building rules', () => {
  it('refuse deux exemplaires du même terrain', () => {
    expect(validateRoster(roster({ terrainCardIds: ['hopital', 'hopital'] })).ok).toBe(false);
    expect(validateRoster(roster({ terrainCardIds: ['hopital', 'protection-divine'] })).ok).toBe(true);
  });

  it('donne à tous les terrains une limite de 1 exemplaire dans le pool', () => {
    const terrains = listDeckPool().filter((entry) => entry.type === 'terrain');
    expect(terrains.length).toBeGreaterThan(0);
    expect(terrains.every((entry) => entry.maxCopies === 1)).toBe(true);
  });

  it('refuse deux exemplaires du même personnage, quel qu’il soit', () => {
    expect(validateRoster(roster({ characterCardIds: ['gojo-satoru', 'gojo-satoru'] })).ok).toBe(false);
    expect(validateRoster(roster({ characterCardIds: ['soraka', 'soraka'] })).ok).toBe(false);
    expect(validateRoster(roster({ characterCardIds: ['gojo-satoru', 'sukuna'] })).ok).toBe(true);
    const characters = listDeckPool().filter((entry) => entry.type === 'character');
    expect(characters.length).toBeGreaterThan(0);
    expect(characters.every((entry) => entry.maxCopies === 1)).toBe(true);
  });

  it('laisse les objets en double, eux', () => {
    expect(validateRoster(roster({ objectCardIds: ['potion-de-soin', 'potion-de-soin'] })).ok).toBe(true);
    // Sauf ceux qui déclarent leur propre limite.
    expect(validateRoster(roster({ objectCardIds: ['determination', 'determination'] })).ok).toBe(false);
  });

  it('interdit Chopper et Soraka dans le même deck, quel que soit leur ordre', () => {
    const chopperFirst = validateRoster(roster({ characterCardIds: ['chopper', 'soraka'] }));
    const sorakaFirst = validateRoster(roster({ characterCardIds: ['soraka', 'chopper'] }));
    expect(chopperFirst.ok).toBe(false);
    expect(sorakaFirst.ok).toBe(false);
    // Le message nomme les deux cartes, dans le même ordre quel que soit celui du deck.
    expect(chopperFirst.ok === false && chopperFirst.error).toContain('Chopper');
    expect(chopperFirst.ok === false && chopperFirst.error).toContain('Soraka');
    expect(sorakaFirst.ok === false && sorakaFirst.error).toBe(chopperFirst.ok === false && chopperFirst.error);
    // Chacune reste jouable seule.
    expect(validateRoster(roster({ characterCardIds: ['chopper'] })).ok).toBe(true);
    expect(validateRoster(roster({ characterCardIds: ['soraka'] })).ok).toBe(true);
  });

  it('symétrise l\'incompatibilité dans le pool, sans que la carte ait à la déclarer', () => {
    const pool = listDeckPool();
    expect(pool.find((entry) => entry.id === 'soraka')?.incompatibleWith).toEqual(['chopper']);
    expect(pool.find((entry) => entry.id === 'chopper')?.incompatibleWith).toEqual(['soraka']);
  });

  it('ne connaît plus la carte Brise bouclier', () => {
    expect(listDeckPool().some((entry) => entry.id === 'brise-bouclier')).toBe(false);
    expect(validateRoster(roster({ terrainCardIds: ['brise-bouclier'] })).ok).toBe(false);
  });

  // Le deck servi au joueur qui n'en a jamais composé : il doit remplir toutes ses places,
  // sinon la première partie se joue avec un deck à moitié vide.
  it('livre un deck de démo complet et légal', () => {
    expect(validateRoster(DEMO_STARTER_DECK)).toEqual({ ok: true });
    expect(DEMO_STARTER_DECK.characterCardIds).toHaveLength(DECK_LIMITS.character);
    expect(DEMO_STARTER_DECK.objectCardIds).toHaveLength(DECK_LIMITS.object);
    expect(DEMO_STARTER_DECK.terrainCardIds).toHaveLength(DECK_LIMITS.terrain);
  });
});
