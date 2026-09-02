import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { yugi } from '../src/cards/demo/yugi.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let yugiRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!yugiRegistered) {
    yugiRegistered = true;
    registerCard(yugi);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: [yugi.id, ...FX_ROSTER.characterCardIds],
  objectCardIds: [],
  terrainCardIds: [],
};

/**
 * "Puzzle Millénaire" tire au hasard parmi 6 branches à poids inégaux (40/20/15/4/1/20 %),
 * entièrement dans le fichier de carte (pas de nouveau mécanisme moteur pour le tirage
 * lui-même -- seule l'extension `negatesOriginal` de `damage-reflect` en est un, couverte
 * séparément par damage-reflect-negate.spec.ts). Fuzz sur de nombreuses graines plutôt que
 * de figer une graine par branche : les 4 branches à ≥15 % sont pratiquement certaines
 * d'apparaître sur 60 tirages (p(rater la plus rare des quatre) ≈ 3×10⁻⁵), donc l'absence
 * de crash ET une bonne diversité d'issues valent comme preuve que chaque branche s'exécute
 * proprement, sans dépendre des branches à 4 % / 1 % (trop rares pour être fiables ici).
 */
describe('Yugi -- Puzzle Millénaire (tirage pondéré à 6 branches)', () => {
  it('ne plante sur aucune branche et couvre une bonne diversité d’issues', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const outcomesSeen = new Set<string>();

    for (let seed = 0; seed < 60; seed++) {
      const match = await createReadyMatch(
        { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed },
        { p1ActiveCardId: 'yugi', p2ActiveCardId: 'fx-tank' }
      );
      if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });
      const yugiId = match.state.players[owner].activeCharacterInstanceId!;

      // Pas d'autoAnswer custom : les prompts (choix soin / résurrection) retombent sur le
      // même défaut que le serveur applique après 120 s (première option légale) -- exactement
      // ce que la carte doit rester capable d'encaisser sans planter.
      await drive(match, owner, { kind: 'use-ability', characterInstanceId: yugiId, abilityId: 'puzzle-millenaire' });

      const rollLine = match.state.log.find((entry) => entry.message.startsWith('Puzzle Millénaire : '));
      expect(rollLine).toBeDefined();
      outcomesSeen.add(rollLine!.message.slice('Puzzle Millénaire : '.length));
    }

    expect(outcomesSeen.size).toBeGreaterThanOrEqual(4);
  });
});
