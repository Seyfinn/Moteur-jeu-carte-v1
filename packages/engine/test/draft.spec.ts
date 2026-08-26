import { beforeAll, describe, expect, it } from 'vitest';
import {
  DECK_LIMITS,
  RANDOM_POOL_SIZE,
  createRng,
  draftIssue,
  drawRandomPool,
  drawRandomPools,
  listDeckPool,
  registerDemoCards,
  validateDraftedRoster,
  type DraftPool,
  type RosterConfig,
} from '../src/index.js';

beforeAll(() => {
  registerDemoCards();
});

/**
 * Un deck légal COMPLET composé gloutonnement dans la réserve. Prendre bêtement les
 * premières cartes ne suffit pas : une réserve aléatoire peut très bien contenir deux
 * cartes incompatibles entre elles (Chopper et Soraka), et le deck serait alors refusé.
 */
function firstLegalDeck(pool: DraftPool): RosterConfig {
  const roster: RosterConfig = { characterCardIds: [], objectCardIds: [], terrainCardIds: [] };
  const groups = [
    { key: 'characterCardIds', max: DECK_LIMITS.character },
    { key: 'objectCardIds', max: DECK_LIMITS.object },
    { key: 'terrainCardIds', max: DECK_LIMITS.terrain },
  ] as const;

  for (const group of groups) {
    for (const id of pool[group.key]) {
      if (roster[group.key].length >= group.max) break;
      roster[group.key].push(id);
      if (!validateDraftedRoster(roster, pool).ok) roster[group.key].pop();
    }
  }
  return roster;
}

describe('Mode Aléatoire -- le tirage', () => {
  it('tire 10 / 10 / 6 cartes distinctes du bon type', () => {
    const pool = drawRandomPool(createRng(1234));

    expect(pool.characterCardIds).toHaveLength(RANDOM_POOL_SIZE.character);
    expect(pool.objectCardIds).toHaveLength(RANDOM_POOL_SIZE.object);
    expect(pool.terrainCardIds).toHaveLength(RANDOM_POOL_SIZE.terrain);

    // Distinctes à l'intérieur d'une même réserve.
    for (const ids of [pool.characterCardIds, pool.objectCardIds, pool.terrainCardIds]) {
      expect(new Set(ids).size).toBe(ids.length);
    }

    // Et du bon type, ce qu'un tirage à plat sur listCards() ne garantirait pas.
    const typeById = new Map(listDeckPool().map((e) => [e.id, e.type] as const));
    for (const id of pool.characterCardIds) expect(typeById.get(id)).toBe('character');
    for (const id of pool.objectCardIds) expect(typeById.get(id)).toBe('object');
    for (const id of pool.terrainCardIds) expect(typeById.get(id)).toBe('terrain');
  });

  it('donne aux deux joueurs des tirages différents, sans exiger qu\'ils soient disjoints', () => {
    const { p1, p2 } = drawRandomPools(createRng(99));
    // Deux réserves indépendantes : elles ne doivent pas être identiques...
    expect(p1).not.toEqual(p2);
    // ... mais un recouvrement est parfaitement admis (il est même inévitable sur les
    // terrains : 6 + 6 = 12 pour 11 terrains dans le jeu).
    expect(listDeckPool().filter((e) => e.type === 'terrain').length).toBeLessThan(
      RANDOM_POOL_SIZE.terrain * 2
    );
  });

  it("n'inclut jamais une forme évoluée (elles ne sont pas sélectionnables)", () => {
    const selectable = new Set(listDeckPool().map((e) => e.id));
    for (let seed = 0; seed < 25; seed++) {
      const pool = drawRandomPool(createRng(seed));
      for (const id of [...pool.characterCardIds, ...pool.objectCardIds, ...pool.terrainCardIds]) {
        expect(selectable.has(id)).toBe(true);
      }
    }
  });
});

describe('Mode Aléatoire -- validation du deck composé', () => {
  // Tirée dans un beforeAll et pas dans le corps du describe : celui-ci s'exécute à la
  // collecte, avant `registerDemoCards()`, et la réserve serait vide.
  let pool: DraftPool;
  beforeAll(() => {
    pool = drawRandomPool(createRng(2024));
  });

  it('accepte un deck entièrement pris dans la réserve', () => {
    expect(validateDraftedRoster(firstLegalDeck(pool), pool).ok).toBe(true);
    expect(draftIssue(firstLegalDeck(pool), pool)).toBeNull();
  });

  it('refuse une carte absente de la réserve, même si le deck est légal par ailleurs', () => {
    const outsider = listDeckPool().find(
      (e) => e.type === 'character' && !pool.characterCardIds.includes(e.id)
    )!;
    const cheated = firstLegalDeck(pool);
    cheated.characterCardIds = [outsider.id, ...cheated.characterCardIds.slice(1)];

    const result = validateDraftedRoster(cheated, pool);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("n'est pas dans votre tirage");
  });

  it('autorise deux exemplaires d\'un objet de la réserve (règle 3b)', () => {
    const doubled = firstLegalDeck(pool);
    // Un objet dont maxCopies vaut 2, pris deux fois : la réserve n'en montre qu'un, mais
    // c'est `maxCopies` qui décide combien on peut en jouer.
    const twoCopies = listDeckPool().find(
      (e) => pool.objectCardIds.includes(e.id) && e.maxCopies >= 2
    )!;
    expect(twoCopies).toBeDefined();
    doubled.objectCardIds = [
      twoCopies.id,
      twoCopies.id,
      ...doubled.objectCardIds.filter((id) => id !== twoCopies.id).slice(0, DECK_LIMITS.object - 2),
    ];

    expect(validateDraftedRoster(doubled, pool).ok).toBe(true);
  });

  it('applique toujours les règles de deck (quotas dépassés)', () => {
    const tooMany = firstLegalDeck(pool);
    tooMany.characterCardIds = pool.characterCardIds.slice(0, DECK_LIMITS.character + 1);
    expect(validateDraftedRoster(tooMany, pool).ok).toBe(false);
  });

  it('exige un deck COMPLET avant de pouvoir le soumettre', () => {
    const incomplete = firstLegalDeck(pool);
    incomplete.characterCardIds = incomplete.characterCardIds.slice(0, 4);
    // Légal au sens de l'éditeur (les quotas y sont des plafonds)...
    expect(validateDraftedRoster(incomplete, pool).ok).toBe(true);
    // ... mais pas soumettable : un draft se remplit jusqu'au bout.
    expect(draftIssue(incomplete, pool)).toContain('personnage');
  });
});
