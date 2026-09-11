import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { zoe } from '../src/cards/demo/zoe.js';
import { soma } from '../src/cards/demo/soma.js';
import { ornn } from '../src/cards/demo/ornn.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

let zoeRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!zoeRegistered) {
    zoeRegistered = true;
    registerCard(zoe);
    registerCard(soma);
    registerCard(ornn);
  }
});

function opponentOf(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

const ZOE_ROSTER: RosterConfig = { characterCardIds: [zoe.id], objectCardIds: [], terrainCardIds: [] };
const SOMA_ROSTER: RosterConfig = { characterCardIds: [soma.id], objectCardIds: [], terrainCardIds: [] };
const ORNN_ROSTER: RosterConfig = { characterCardIds: [ornn.id], objectCardIds: [], terrainCardIds: [] };
const ZOE_AND_TANK_ROSTER: RosterConfig = { characterCardIds: [zoe.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

describe('Zoé "Spell Thief" (tracks + re-executes the enemy\'s last active ability, Zoé as source)', () => {
  it("re-executes the stolen ability with Zoé as the source (the buff lands on her, not the original caster)", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: FX_ROSTER, seed: 80 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const zoeSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== enemySide) await drive(match, zoeSide, { kind: 'pass' });

    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'self-buff' });
    expect(match.state.players[enemySide].characters[enemyActiveId]!.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true);

    await drive(match, enemySide, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(zoeSide);

    await drive(match, zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });

    const zoeChar = match.state.players[zoeSide].characters[zoeActiveId]!;
    expect(zoeChar.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true); // stolen buff landed on Zoé herself
    expect(zoeChar.statuses.some((s) => s.statusId === 'zoe-spell-thief-cooldown')).toBe(true);

    // Immediate reuse is blocked by the 3-turn cooldown.
    const secondAttempt = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(secondAttempt.ok).toBe(false);
  });

  it('is unusable with nothing recorded yet, and becomes usable again once the cooldown fully ticks off', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: FX_ROSTER, seed: 82 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const zoeSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    // Nothing recorded yet: condition() must refuse the action outright, on Zoé's own turn.
    if (match.state.activePlayerId !== zoeSide) await drive(match, enemySide, { kind: 'pass' });
    const tooEarly = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(tooEarly.ok).toBe(false);
    await drive(match, zoeSide, { kind: 'pass' });

    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'self-buff' });
    await drive(match, enemySide, { kind: 'pass' });
    await drive(match, zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    await drive(match, zoeSide, { kind: 'pass' });

    // 3-turn cooldown: still blocked on Zoé's next three turns, usable again on the fourth.
    for (let i = 0; i < 3; i++) {
      await drive(match, enemySide, { kind: 'pass' });
      const blocked = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
      expect(blocked.ok).toBe(false);
      await drive(match, zoeSide, { kind: 'pass' });
    }
    await drive(match, enemySide, { kind: 'pass' });
    const readyAgain = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(readyAgain.ok).toBe(true);
  });

  it("records an ability that neutralises Zoé while resolving (Soma's Menu Surprise stuns her)", async () => {
    // Régression : la mémoire était prise par une passive branchée sur `onAbilityUsed`, émis
    // APRÈS l'exécution -- une capacité qui stun/silence Zoé en se résolvant se rendait donc
    // involable. Le moteur note maintenant la capacité avant de l'exécuter.
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: SOMA_ROSTER, seed: 84 }
    );
    const zoeSide: PlayerId = 'p1';
    const enemySide: PlayerId = opponentOf(zoeSide);
    if (match.state.activePlayerId !== enemySide) await drive(match, zoeSide, { kind: 'pass' });

    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'menu-surprise' });
    expect(match.state.players[enemySide].lastAbilityUsed).toEqual({
      characterInstanceId: enemyActiveId,
      abilityId: 'menu-surprise',
    });

    // Le plat a stun Zoé : ce tour-là reste bel et bien perdu (le stun ferme les actives).
    await drive(match, enemySide, { kind: 'pass' });
    expect(match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' }).ok).toBe(false);

    // Mais la mémoire a survécu : une fois le stun tombé, Menu Surprise est volable.
    await drive(match, zoeSide, { kind: 'pass' });
    await drive(match, enemySide, { kind: 'pass' });
    await drive(match, zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(match.state.players[zoeSide].characters[zoeActiveId]!.statuses.some((s) => s.statusId === 'zoe-spell-thief-cooldown')).toBe(true);
  });
  it("refuses an ability whose own condition doesn't hold for Zoé (Ornn's Living Forge without materials)", async () => {
    // Régression : la capacité volée s'exécute AVEC ZOÉ POUR SOURCE, mais sa condition
    // n'était jamais consultée. Zoé pouvait donc rejouer Living Forge sans avoir le moindre
    // matériau -- s'immobilisant 3 tours (chained + disarmed) pour rien, recharge comprise.
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: ORNN_ROSTER, seed: 90 });
    const zoeSide: PlayerId = 'p1';
    const ornnSide: PlayerId = opponentOf(zoeSide);
    if (match.state.activePlayerId !== ornnSide) await drive(match, zoeSide, { kind: 'pass' });

    const ornnId = match.state.players[ornnSide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    // Ornn récupère ses matériaux (son attaque ferme son tour), puis lance Living Forge.
    await drive(match, ornnSide, { kind: 'attack', characterInstanceId: ornnId, attackId: 'recuperation-de-materiaux' });
    await drive(match, zoeSide, { kind: 'pass' });
    await drive(match, ornnSide, { kind: 'use-ability', characterInstanceId: ornnId, abilityId: 'living-forge' });
    await drive(match, ornnSide, { kind: 'pass' });

    expect(match.state.players[ornnSide].lastAbilityUsed?.abilityId).toBe('living-forge');
    const attempt = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(attempt.ok).toBe(false);

    const zoeChar = match.state.players[zoeSide].characters[zoeActiveId]!;
    expect(zoeChar.statuses.some((s) => s.statusId === 'chained')).toBe(false);
    expect(zoeChar.statuses.some((s) => s.statusId === 'zoe-spell-thief-cooldown')).toBe(false);
  });

  it('survives a Zoé facing another Zoé (the two Spell Thiefs must not interrogate each other forever)', async () => {
    // Rien n'interdit aux deux camps d'aligner leur Zoé. Comme Spell Thief consulte
    // désormais la condition de ce qu'il vole, et que cette condition est elle-même un
    // Spell Thief, la question rebondissait d'une Zoé à l'autre jusqu'à faire exploser la
    // pile : le garde de ré-entrance de `shared.ts::isRelaunchable` coupe la boucle.
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_AND_TANK_ROSTER, p2Roster: ZOE_AND_TANK_ROSTER, seed: 92 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    const zoeSide: PlayerId = 'p1';
    const mirrorSide: PlayerId = opponentOf(zoeSide);
    if (match.state.activePlayerId !== zoeSide) await drive(match, mirrorSide, { kind: 'pass' });

    const ownZoeId = findInstance(match, zoeSide, zoe.id);
    const mirrorZoeId = findInstance(match, mirrorSide, zoe.id);

    // On donne d'abord quelque chose à voler à la Zoé d'en face, puis les deux camps
    // amènent leur Zoé au poste actif (le switch ferme le tour).
    await drive(match, zoeSide, {
      kind: 'use-ability',
      characterInstanceId: match.state.players[zoeSide].activeCharacterInstanceId!,
      abilityId: 'self-buff',
    });
    await drive(match, zoeSide, { kind: 'switch', newActiveInstanceId: ownZoeId });
    await drive(match, mirrorSide, { kind: 'switch', newActiveInstanceId: mirrorZoeId });
    await drive(match, zoeSide, { kind: 'pass' });

    // La Zoé d'en face vole : sa dernière capacité utilisée devient "spell-thief".
    await drive(match, mirrorSide, { kind: 'use-ability', characterInstanceId: mirrorZoeId, abilityId: 'spell-thief' });
    await drive(match, mirrorSide, { kind: 'pass' });
    expect(match.state.players[mirrorSide].lastAbilityUsed?.abilityId).toBe('spell-thief');

    // Notre Zoé regarde un Spell Thief : refus net, pas de récursion infinie.
    const attempt = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: ownZoeId, abilityId: 'spell-thief' });
    expect(attempt.ok).toBe(false);
  });
});
