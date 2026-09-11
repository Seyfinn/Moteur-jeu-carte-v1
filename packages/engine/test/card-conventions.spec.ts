import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  DECK_LIMITS,
  DEMO_ROSTER,
  DEMO_STARTER_DECK,
  evolutionFormsOf,
  getCard,
  listCards,
  registerDemoCards,
  validateRoster,
  type CardDef,
  type CharacterCardDef,
} from '../src/index.js';

/**
 * Garde-fous sur le CATALOGUE de cartes lui-même, pas sur une carte en particulier.
 *
 * Ils existent parce que les ratés d'ajout de carte se répètent toujours aux mêmes endroits
 * (voir le workflow de CLAUDE.md) : un fichier écrit mais jamais `registerCard`, une carte
 * absente de `DEMO_ROSTER` donc introuvable dans le deck-builder, une entrée oubliée dans
 * `docs/cartes.md`, des HP retouchés dans le code mais pas dans la doc. Rien de tout ça ne
 * casse un test de mécanique : la carte marche, elle est seulement injouable ou mal
 * documentée -- exactement ce qu'une suite de tests par carte ne voit pas.
 *
 * Volontairement structurels : aucun de ces tests ne juge l'équilibrage d'une carte ni ne
 * relit son texte imprimé (le dossier `ADMIN Cartes tout/` reste la seule source de vérité
 * là-dessus). Ils vérifient qu'une carte existante est atteignable, cohérente avec
 * elle-même, et documentée.
 */
beforeAll(() => {
  registerDemoCards();
});

/** Les cartes de démo seules : les fixtures de test (`fx-*`) n'ont ni fichier ni doc. */
function demoCards(): CardDef[] {
  return listCards().filter((c) => !c.id.startsWith('fx-'));
}

function demoCharacters(): CharacterCardDef[] {
  return demoCards().filter((c): c is CharacterCardDef => c.type === 'character');
}

function demoCardFiles(): string[] {
  const dir = new URL('../src/cards/demo/', import.meta.url);
  // `index.ts` est le registre lui-même, `shared.ts` un helper (simpleAttack) : ni l'un ni
  // l'autre ne déclare de carte.
  return readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'shared.ts');
}

describe('catalogue de cartes -- un fichier, une carte, un id', () => {
  it('chaque fichier de cards/demo est enregistré sous son propre nom de fichier', () => {
    const ids = new Set(demoCards().map((c) => c.id));
    const orphans = demoCardFiles()
      .map((f) => f.slice(0, -'.ts'.length))
      .filter((id) => !ids.has(id));
    // Presque toujours un `registerCard(...)` oublié dans cards/demo/index.ts.
    expect(orphans, 'fichiers de carte jamais enregistrés (registerDemoCards)').toEqual([]);
  });

  it("chaque carte enregistrée a le fichier qui porte son id", () => {
    const files = new Set(demoCardFiles());
    const missing = demoCards()
      .map((c) => c.id)
      .filter((id) => !files.has(id + '.ts'));
    expect(missing, "cartes dont l'id ne correspond à aucun fichier").toEqual([]);
  });

  it('aucun nom de carte en double (journal et modales nomment par le nom)', () => {
    const byName = new Map<string, string[]>();
    for (const card of demoCards()) {
      byName.set(card.name, [...(byName.get(card.name) ?? []), card.id]);
    }
    const collisions = [...byName].filter(([, ids]) => ids.length > 1);
    expect(collisions).toEqual([]);
  });
});

describe('DEMO_ROSTER -- le pool complet du deck-builder', () => {
  const rosterEntries = () => [
    ...DEMO_ROSTER.characterCardIds.map((id) => ({ id, type: 'character' as const })),
    ...DEMO_ROSTER.objectCardIds.map((id) => ({ id, type: 'object' as const })),
    ...DEMO_ROSTER.terrainCardIds.map((id) => ({ id, type: 'terrain' as const })),
  ];

  it('ne contient que des cartes existantes, rangées sous le bon type', () => {
    const wrong = rosterEntries().filter(({ id, type }) => {
      try {
        return getCard(id).type !== type;
      } catch {
        return true; // id fantôme
      }
    });
    expect(wrong).toEqual([]);
  });

  it("ne liste jamais deux fois la même carte (c'est un pool, pas un deck)", () => {
    const ids = rosterEntries().map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("contient toute carte qui n'est pas une forme évoluée", () => {
    const inRoster = new Set(rosterEntries().map((e) => e.id));
    const evolvedForms = new Set(demoCards().flatMap((c) => evolutionFormsOf(c)));
    // Une carte hors pool ET hors `evolvesTo` n'est atteignable par aucun chemin : ni deck
    // construit, ni tirage aléatoire, ni évolution. Elle existe sans exister.
    const unreachable = demoCards()
      .map((c) => c.id)
      .filter((id) => !inRoster.has(id) && !evolvedForms.has(id));
    expect(unreachable, 'cartes injouables : ni dans DEMO_ROSTER, ni forme évoluée').toEqual([]);
  });

  it('ne fait jamais entrer une forme évoluée dans le pool', () => {
    const inRoster = new Set(rosterEntries().map((e) => e.id));
    const leaked = demoCards()
      .flatMap((c) => evolutionFormsOf(c))
      .filter((id) => inRoster.has(id));
    expect(leaked, 'formes évoluées listées dans le pool (elles ne comptent pas dans le quota)').toEqual([]);
  });
});

describe('DEMO_STARTER_DECK -- le deck par défaut', () => {
  it('est un deck légal', () => {
    expect(validateRoster(DEMO_STARTER_DECK)).toEqual({ ok: true });
  });

  it('remplit toutes les places (un deck à moitié vide donne une partie à moitié jouée)', () => {
    expect(DEMO_STARTER_DECK.characterCardIds.length).toBe(DECK_LIMITS.character);
    expect(DEMO_STARTER_DECK.objectCardIds.length).toBe(DECK_LIMITS.object);
    expect(DEMO_STARTER_DECK.terrainCardIds.length).toBe(DECK_LIMITS.terrain);
  });
});

describe('cohérence interne des définitions de carte', () => {
  it("les ids d'attaque et de capacité sont uniques au sein d'une carte", () => {
    // Les compteurs d'usage (`abilityUsesThisTurn`/`ThisGame`), les sceaux de Makima et le
    // vol d'attaque sont tous indexés par cet id : deux membres homonymes partageraient
    // silencieusement leur quota.
    const dupes: string[] = [];
    for (const card of demoCharacters()) {
      const seen = new Set<string>();
      for (const id of [...card.attacks.map((a) => a.id), ...card.abilities.map((a) => a.id)]) {
        if (seen.has(id)) dupes.push(card.id + '/' + id);
        seen.add(id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("aucune capacité activable manuellement n'est cachée de la fiche", () => {
    // `hidden` est réservé à la plomberie (compteurs, mémoire d'un choix). Une capacité que
    // le joueur déclenche lui-même doit rester lisible -- cf. CLAUDE.md.
    const hiddenActives = demoCharacters().flatMap((c) =>
      c.abilities.filter((a) => a.hidden && a.kind === 'active' && !a.trigger).map((a) => c.id + '/' + a.id)
    );
    expect(hiddenActives).toEqual([]);
  });

  it('les quotas et les durées déclarés sont des nombres utilisables', () => {
    const bad: string[] = [];
    for (const card of demoCards()) {
      if (card.maxCopies !== undefined && card.maxCopies < 1) bad.push(card.id + ' maxCopies');
      if (card.type === 'terrain' && card.durationTurns !== undefined && card.durationTurns < 1) {
        bad.push(card.id + ' durationTurns');
      }
      if (card.type !== 'character') continue;
      if (card.baseMaxHP < 1) bad.push(card.id + ' baseMaxHP');
      for (const attack of card.attacks) {
        if (attack.baseATK < 0) bad.push(card.id + '/' + attack.id + ' baseATK');
      }
      for (const ability of card.abilities) {
        if (ability.usesPerTurn !== undefined && ability.usesPerTurn < 1) bad.push(card.id + '/' + ability.id + ' usesPerTurn');
        if (ability.usesPerGame !== undefined && ability.usesPerGame < 1) bad.push(card.id + '/' + ability.id + ' usesPerGame');
      }
    }
    expect(bad).toEqual([]);
  });

  it('`incompatibleWith` pointe sur une carte réelle, une seule fois, et jamais sur soi', () => {
    const problems: string[] = [];
    for (const card of demoCards()) {
      for (const otherId of card.incompatibleWith ?? []) {
        if (otherId === card.id) problems.push(card.id + " s'exclut lui-même");
        let other: CardDef;
        try {
          other = getCard(otherId);
        } catch {
          problems.push(card.id + ' -> ' + otherId + ' (carte inconnue)');
          continue;
        }
        // La relation est déjà symétrique côté moteur : la déclarer des deux côtés est une
        // redondance qui finit par diverger.
        if ((other.incompatibleWith ?? []).includes(card.id)) {
          problems.push(card.id + ' <-> ' + otherId + ' déclaré des deux côtés');
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('`evolvesTo` mène à un personnage réel, différent de la carte de base', () => {
    const problems: string[] = [];
    for (const card of demoCards()) {
      for (const formId of evolutionFormsOf(card)) {
        if (formId === card.id) problems.push(card.id + ' évolue en lui-même');
        try {
          if (getCard(formId).type !== 'character') problems.push(card.id + ' -> ' + formId + " n'est pas un personnage");
        } catch {
          problems.push(card.id + ' -> ' + formId + ' (carte inconnue)');
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('docs/cartes.md -- la note de travail suit le code', () => {
  const doc = () => readFileSync(new URL('../../../docs/cartes.md', import.meta.url), 'utf8');
  /** Les titres de niveau 3 : « Nom », « Nom — 300 HP », « Nom — objet à lier »... */
  const headings = () => [...doc().matchAll(/^### (.+)$/gm)].map((m) => m[1]!.trim());
  const headingFor = (name: string) =>
    headings().find((h) => h === name || h.startsWith(name + ' —') || h.startsWith(name + ' -'));

  it('chaque carte a son entrée', () => {
    const undocumented = demoCards()
      .filter((c) => !headingFor(c.name))
      .map((c) => c.name + ' (' + c.id + ')');
    expect(undocumented, 'cartes sans entrée dans docs/cartes.md').toEqual([]);
  });

  it('les HP annoncés dans le titre sont ceux de la carte', () => {
    const drifted: string[] = [];
    for (const card of demoCharacters()) {
      const heading = headingFor(card.name);
      if (!heading) continue; // déjà signalé par le test précédent
      const hp = heading.match(/(\d+)\s*HP/);
      if (!hp) drifted.push(heading + ' (titre sans HP)');
      else if (Number(hp[1]) !== card.baseMaxHP) drifted.push(heading + ' mais baseMaxHP=' + card.baseMaxHP);
    }
    expect(drifted).toEqual([]);
  });
});
