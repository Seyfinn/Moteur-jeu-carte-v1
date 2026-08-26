import { beforeAll, describe, expect, it } from 'vitest';
import {
  canAttack,
  canAttackFromBench,
  canSwitchStandard,
  registerCard,
  type Match,
  type PendingChoice,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { makima } from '../src/cards/demo/makima.js';
import { yumeko } from '../src/cards/demo/yumeko.js';
import { lightYagami } from '../src/cards/demo/light-yagami.js';
import { getEffectiveATK } from '../src/queries.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    registerCard(makima);
    registerCard(yumeko);
    registerCard(lightYagami);
  }
});

/** Which side opens is seed-dependent; these tests need a named player to be the one acting. */
async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

/** Répond `optionKey` à toute modale `select-option`, et laisse le défaut faire le reste. */
function answerOption(optionKey: string) {
  return (choice: PendingChoice) => {
    if (choice.spec.kind === 'select-option' && choice.spec.options.some((o) => o.key === optionKey)) {
      return { kind: 'select-option' as const, key: optionKey };
    }
    return defaultAnswer(choice);
  };
}

const P2_ROSTER: RosterConfig = {
  characterCardIds: ['fx-tank', 'fx-stunner'],
  objectCardIds: [],
  terrainCardIds: [],
};

describe('Makima -- "Sacrifice" scelle UNE compétence nommée', () => {
  const ROSTER: RosterConfig = { characterCardIds: [makima.id, 'fx-striker'], objectCardIds: [], terrainCardIds: [] };

  it('ferme une seule attaque du banc allié et laisse les autres jouables', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 7 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');

    const makimaId = findInstance(match, 'p1', makima.id);
    const strikerId = findInstance(match, 'p1', 'fx-striker');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('strike'));

    // Le sceau vise "strike" et rien d'autre : c'est toute la différence avec un `disarmed`,
    // qui aurait fermé le personnage entier.
    expect(canAttack(match.state, strikerId, 'strike').allow).toBe(false);
    expect(canAttack(match.state, strikerId, 'no-end-strike').allow).toBe(true);
    // Sans `attackId`, la requête jauge le personnage en général : elle ne doit rien refuser.
    expect(canAttack(match.state, strikerId).allow).toBe(true);
  });

  it('monte "Bang !" de 30 par sceau, et le fait redescendre si le sacrifié meurt', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 7 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = findInstance(match, 'p1', makima.id);
    const strikerId = findInstance(match, 'p1', 'fx-striker');

    expect(getEffectiveATK(match.state, makimaId, 40)).toBe(40);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('strike'));
    expect(getEffectiveATK(match.state, makimaId, 40)).toBe(70);

    // Le sceau vit sur le sacrifié : il part avec lui au cimetière, et Bang ! redescend.
    match.state.players.p1.characters[strikerId]!.statuses = [];
    expect(getEffectiveATK(match.state, makimaId, 40)).toBe(40);
  });
});

describe('Makima -- "Manipulation" : la capacité ferme son tour, le moteur retourne l\'attaque adverse', () => {
  const ROSTER: RosterConfig = { characterCardIds: [makima.id, 'fx-striker'], objectCardIds: [], terrainCardIds: [] };

  it("fait frapper l'actif adverse sur son propre banc, puis lui prend son tour", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 11 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = findInstance(match, 'p1', makima.id);
    const benchFoeId = findInstance(match, 'p2', 'fx-stunner');

    // Deux sacrifices sont requis, et "Sacrifice" est limité à un par tour : il faut deux tours.
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('strike'));
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('instant-ko'));

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'manipulation' });

    // Trois choses d'un coup : le tour de Makima s'est refermé sur l'activation, le tour d'en
    // face s'est ouvert puis aussitôt refermé sur l'attaque retournée (fx-tank « poke » à 10),
    // et la main revient donc à Makima.
    expect(match.state.players.p2.characters[benchFoeId]!.damage).toBe(10);
    expect(match.state.activePlayerId).toBe('p1');
    // Statut consommé : la manipulation ne rejoue pas au tour suivant.
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;
    expect(match.state.players.p2.characters[foeActiveId]!.statuses.some((s) => s.statusId === 'forced-attack')).toBe(false);
  });
});

describe('Yumeko -- "Bonus" ouvre l\'attaque depuis le banc, une seule fois', () => {
  const ROSTER: RosterConfig = { characterCardIds: [yumeko.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("refuse l'attaque du banc tant que la mise n'est pas partie de là, puis l'autorise", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 3 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const yumekoId = findInstance(match, 'p1', yumeko.id);

    // Par défaut, personne n'attaque depuis le banc.
    expect(canAttackFromBench(match.state, yumekoId).allow).toBe(false);
    const refused = match.applyAction('p1', { kind: 'attack', characterInstanceId: yumekoId, attackId: 'mise-a-fond' });
    expect(refused.ok).toBe(false);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: yumekoId, abilityId: 'mise-a-mort' }, answerOption('40'));

    expect(canAttackFromBench(match.state, yumekoId).allow).toBe(true);
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: yumekoId, attackId: 'mise-a-fond' });
    expect(match.state.activePlayerId).toBe('p2'); // l'attaque ferme le tour comme n'importe quelle autre

    // Le passage du banc est brûlé pour de bon : Mise à mort n'y est plus proposable.
    await drive(match, 'p2', { kind: 'pass' });
    const secondTry = match.applyAction('p1', { kind: 'use-ability', characterInstanceId: yumekoId, abilityId: 'mise-a-mort' });
    expect(secondTry.ok).toBe(false);
  });
});

describe('Light Yagami -- horloge de la crise cardiaque', () => {
  const ROSTER: RosterConfig = { characterCardIds: [lightYagami.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('tue l\'actif adverse resté 5 tours d\'affilée au poste actif', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 5 },
      { p1ActiveCardId: lightYagami.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const victimId = findInstance(match, 'p2', 'fx-tank');

    // Quatre tours adverses passent : l'horloge tourne sans tuer.
    for (let i = 0; i < 4; i++) {
      await drive(match, 'p1', { kind: 'pass' });
      await drive(match, 'p2', { kind: 'pass' });
    }
    expect(match.state.players.p2.graveyardCharacterInstanceIds).not.toContain(victimId);

    // Le 5e début de tour adverse déclenche la crise cardiaque.
    await drive(match, 'p1', { kind: 'pass' });
    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(victimId);
  });

  it('remet le compteur à zéro sur un switch et inflige 60 à l\'entrant ("Contrainte")', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 5 },
      { p1ActiveCardId: lightYagami.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const fleeingId = findInstance(match, 'p2', 'fx-tank');
    const incomingId = findInstance(match, 'p2', 'fx-stunner');

    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    await drive(match, 'p1', { kind: 'pass' });
    // Deux débuts de tour adverses : l'horloge est lancée.
    expect(match.state.players.p2.characters[fleeingId]!.statuses.some((s) => s.statusId === 'light-yagami-crise')).toBe(true);

    await drive(match, 'p2', { kind: 'switch', newActiveInstanceId: incomingId });

    expect(match.state.players.p2.characters[incomingId]!.damage).toBe(60);
    expect(match.state.players.p2.characters[fleeingId]!.statuses.some((s) => s.statusId === 'light-yagami-crise')).toBe(false);
    expect(match.state.players.p2.characters[incomingId]!.statuses.some((s) => s.statusId === 'light-yagami-crise')).toBe(false);
  });

  it('"Manipulation" ferme le switch de base sans enchaîner la cible', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 5 },
      { p1ActiveCardId: lightYagami.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const lightId = findInstance(match, 'p1', lightYagami.id);
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: lightId, abilityId: 'manipulation' });
    await drive(match, 'p1', { kind: 'pass' });

    expect(canSwitchStandard(match.state, foeActiveId).allow).toBe(false);
    // Pas 'chained' : un switch forcé par une carte doit toujours pouvoir passer.
    expect(match.state.players.p2.characters[foeActiveId]!.statuses.some((s) => s.statusId === 'chained')).toBe(false);
  });
});
