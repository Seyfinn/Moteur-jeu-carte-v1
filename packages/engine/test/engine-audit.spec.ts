import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineApi } from '../src/engine-api.js';
import { getPlayerView, registerCard, registerDemoCards, type CharacterCardDef, type Match, type PlayerId, type RosterConfig } from '../src/index.js';
import { attaqueClone } from '../src/cards/demo/attaque-clone.js';
import { canUseAbility } from '../src/queries.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive, findInstance, settle } from './test-utils.js';

/**
 * Test-only : une passive qui pose une question à son propriétaire à CHAQUE début de tour,
 * le sien comme celui d'en face. Sert à vérifier qu'un prompt levé une fois le tour rendu
 * n'est plus annulable par l'auteur de l'action qui a fermé ce tour.
 */
const fxAuditAsker: CharacterCardDef = {
  type: 'character',
  id: 'fx-audit-asker',
  name: 'Fixture Audit Asker',
  baseMaxHP: 100,
  attacks: [],
  abilities: [
    {
      id: 'ask',
      name: 'Ask',
      kind: 'passive',
      description: 'Asks its owner a yes/no question at every turn start (both sides).',
      trigger: 'onTurnStart',
      usableFromBench: true,
      usesPerTurn: Infinity,
      async execute(ctx) {
        await ctx.chooseYesNo('Fixture : continuer ?');
      },
    },
  ],
};

/**
 * Test-only : une attaque qui tue (10 dégâts, assez pour fx-glass) PUIS pose une question à
 * son auteur. Le prompt de remplacement adverse s'intercale entre les deux.
 */
const fxAuditKillerAsker: CharacterCardDef = {
  type: 'character',
  id: 'fx-audit-killer-asker',
  name: 'Fixture Audit Killer Asker',
  baseMaxHP: 100,
  abilities: [],
  attacks: [
    {
      id: 'kill-then-ask',
      name: 'Kill then ask',
      baseATK: 10,
      description: 'Deals 10 to the enemy active, then asks its owner a yes/no question.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) await ctx.dealDamage(target.instanceId, 10, { skipEvasionRoll: true });
        await ctx.chooseYesNo('Fixture : et maintenant ?');
      },
    },
  ],
};

beforeAll(() => {
  registerTestFixtures();
  registerDemoCards();
  registerCard(fxAuditAsker);
  registerCard(fxAuditKillerAsker);
});

function apiOf(match: Match): EngineApi {
  return (match as unknown as { api: EngineApi }).api;
}

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

const CLONE_ROSTER: RosterConfig = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: [attaqueClone.id],
  terrainCardIds: [],
};

describe("'extra-attack' : la contrepartie différée (onExpire) survit à la consommation", () => {
  it('pose bien le silence différé quand la seconde attaque a été prise', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: CLONE_ROSTER, p2Roster: FX_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;
    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });
    const attackerId = me.activeCharacterInstanceId!;

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(match.state.activePlayerId).toBe('p1');
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(match.state.activePlayerId).toBe('p2');
    // Le statut consommé disparaît (comportement existant, cf. attaque-clone.spec.ts)...
    expect(me.characters[attackerId]!.statuses.some((s) => s.statusId === 'extra-attack')).toBe(false);

    const silenced = () => me.characters[attackerId]!.statuses.some((s) => s.statusId === 'silence-active');
    // ...mais sa contrepartie doit couvrir exactement les 2 tours suivants, comme quand la
    // seconde attaque n'a pas été prise.
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(true); // 1er tour bloqué
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(true); // 2e tour bloqué
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(false); // dette payée
  });

  it("ne dépense pas la charge sur une attaque qui ne fermait de toute façon pas le tour", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: CLONE_ROSTER, p2Roster: FX_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;
    const foe = match.state.players.p2;
    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });
    const attackerId = me.activeCharacterInstanceId!;
    const defenderId = foe.activeCharacterInstanceId!;

    // Attaque gratuite (endsTurn: false) : le tour reste ouvert de lui-même, la charge
    // d'Attaque cloné ne doit pas être brûlée dessus.
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'no-end-strike' });
    expect(match.state.activePlayerId).toBe('p1');
    const grant = me.characters[attackerId]!.statuses.find((s) => s.statusId === 'extra-attack');
    expect(grant?.data?.['remaining']).toBe(1);
    expect(grant?.data?.['armed']).not.toBe(true);

    // La double attaque reste entière : pleine puissance, puis 50 %.
    const before = foe.characters[defenderId]!.damage;
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(foe.characters[defenderId]!.damage - before).toBe(40);
    expect(match.state.activePlayerId).toBe('p1');
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(foe.characters[defenderId]!.damage - before).toBe(60);
    expect(match.state.activePlayerId).toBe('p2');
  });
});

describe('vue joueur : aucune information cachée ne fuit par le choix en attente ni par le journal', () => {
  it("caviarde les options d'un choix adressé à l'adversaire", async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 3 });
    // Un prompt du genre de Caméléon / de la Main Personnage : les options nomment des
    // cartes que seul le joueur interrogé a le droit de voir.
    match.state.pendingChoice = {
      id: 'audit-choice',
      playerId: 'p1',
      cancellable: false,
      spec: {
        kind: 'select-option',
        prompt: 'Choisissez',
        options: [{ key: 'secret', label: 'Carte secrète', card: { cardId: 'fx-heal-object', kind: 'object' } }],
      },
    };
    const own = getPlayerView(match.state, 'p1').pendingChoice;
    expect(own?.spec.kind === 'select-option' && own.spec.options.length).toBe(1);

    const other = getPlayerView(match.state, 'p2').pendingChoice;
    expect(other?.id).toBe('audit-choice');
    expect(other?.playerId).toBe('p1');
    expect(JSON.stringify(other)).not.toContain('fx-heal-object');
    expect(JSON.stringify(other)).not.toContain('Carte secrète');
    match.state.pendingChoice = undefined;
  });

  it("ne révèle pas à l'adversaire la carte qu'un joueur reçoit en main", async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 3 });
    apiOf(match).createObject('p1', 'fx-mirror-object');
    apiOf(match).createTerrain('p1', 'fx-crit-boost-terrain');

    const foeView = getPlayerView(match.state, 'p2');
    const leaked = foeView.log.filter((e) => JSON.stringify(e).includes('fx-mirror-object') || JSON.stringify(e).includes('fx-crit-boost-terrain'));
    expect(leaked).toEqual([]);
    // Le geste reste public (la main grossit), seule l'identité de la carte est privée.
    expect(foeView.log.some((e) => e.data?.['kind'] === 'gain-object')).toBe(true);
    expect(foeView.log.some((e) => e.data?.['kind'] === 'gain-terrain')).toBe(true);
    const ownView = getPlayerView(match.state, 'p1');
    expect(ownView.log.some((e) => JSON.stringify(e).includes('fx-mirror-object'))).toBe(true);
  });
});

describe("annulation d'une action : plus possible une fois le tour rendu", () => {
  it("un prompt levé pendant le début de tour adverse n'est pas annulable par l'auteur du tour précédent", async () => {
    const roster: RosterConfig = { characterCardIds: ['fx-audit-asker', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: roster, p2Roster: FX_ROSTER, seed: 11 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    expect(match.state.activePlayerId).toBe('p1');

    // p1 passe : endTurn -> startTurn de p2 -> la passive de p1 interroge p1.
    const result = match.applyAction('p1', { kind: 'pass' });
    expect(result.ok).toBe(true);
    await match.waitForNextPause();
    const pending = match.state.pendingChoice;
    expect(pending?.playerId).toBe('p1');
    expect(match.state.activePlayerId).toBe('p2');
    expect(pending?.cancellable).toBe(false);
    expect(match.cancelPendingChoice('p1').ok).toBe(false);
    await settle(match);
    expect(match.state.activePlayerId).toBe('p2');
  });
});

describe("'linked' : le partenaire frappe avec l'attaque qu'il a empruntée", () => {
  it("passe par attacksAvailableTo, donc un partenaire sous 'borrowed-attack' attaque quand même", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 8 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const me = match.state.players.p1;
    const strikerId = findInstance(match, 'p1', 'fx-striker');
    const tankId = findInstance(match, 'p1', 'fx-tank');
    me.characters[strikerId]!.statuses.push({ statusId: 'linked', label: 'Lié', data: { partnerInstanceId: tankId } });
    me.characters[tankId]!.statuses.push({ statusId: 'linked', label: 'Lié', data: { partnerInstanceId: strikerId } });
    me.characters[tankId]!.statuses.push({
      statusId: 'borrowed-attack',
      label: 'Emprunt',
      data: { cardId: 'fx-glass', attackId: 'shatter' },
    });

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: strikerId, attackId: 'strike' });
    const partnerAttack = match.state.log.find(
      (e) => e.data?.['kind'] === 'attack' && e.data?.['characterInstanceId'] === tankId
    );
    expect(partnerAttack?.data?.['attackId']).toBe('shatter');
  });
});

describe('résurrection : compteurs de tour remis à zéro', () => {
  it("un personnage ranimé ne traîne pas le compteur « déjà utilisée ce tour » de sa vie précédente", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 8 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    const strikerId = findInstance(match, 'p1', 'fx-striker');
    const striker = match.state.players.p1.characters[strikerId]!;
    striker.abilityUsesThisTurn = { 'instant-ko': 1 };
    await apiOf(match).koCharacter(strikerId);
    await settle(match);
    expect(match.state.players.p1.graveyardCharacterInstanceIds).toContain(strikerId);

    // Le retour se fait hors de tout début de tour (Pheonix revient APRÈS la remise à zéro
    // des compteurs de startTurn) : c'est la résurrection elle-même qui doit nettoyer.
    await apiOf(match).reviveCharacter(strikerId, 50, 'bench');
    await settle(match);
    expect(striker.abilityUsesThisTurn).toEqual({});
    // Promu au poste actif, il doit pouvoir lancer sa capacité 1x/tour.
    match.state.players.p1.activeCharacterInstanceId = strikerId;
    match.state.players.p1.benchCharacterInstanceIds = match.state.players.p1.benchCharacterInstanceIds.filter((id) => id !== strikerId);
    const ability = { id: 'instant-ko', name: 'x', kind: 'active' as const, description: '', async execute() {} };
    expect(canUseAbility(match.state, strikerId, ability).allow).toBe(true);
  });
});

describe('robustesse des accès par id', () => {
  it("destroyObject sur un objet inconnu (recyclé, jamais créé) n'explose pas l'action en cours", async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 3 });
    expect(() => apiOf(match).destroyObject('object-that-does-not-exist')).not.toThrow();
  });
});

describe('abandon : plus aucun prompt ne peut rester armé sur une partie terminée', () => {
  it("un effet qui continue après l'abandon voit ses questions résolues d'office", async () => {
    const roster: RosterConfig = { characterCardIds: ['fx-audit-killer-asker'], objectCardIds: [], terrainCardIds: [] };
    const glass: RosterConfig = { characterCardIds: ['fx-glass', 'fx-glass'], objectCardIds: [], terrainCardIds: [] };
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: roster, p2Roster: glass, seed: 5 });
    await ensureTurn(match, 'p1');
    const attackerId = findInstance(match, 'p1', 'fx-audit-killer-asker');
    // Le coup tue l'actif adverse : p2 doit choisir son remplaçant avant que l'attaque ne
    // pose sa propre question à p1.
    expect(match.applyAction('p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'kill-then-ask' }).ok).toBe(true);
    await match.waitForNextPause();
    expect(match.state.pendingChoice?.playerId).toBe('p2');

    expect(match.forfeit('p1').ok).toBe(true);
    await match.waitForNextPause();
    expect(match.state.phase).toBe('ended');
    expect(match.state.result).toEqual({ kind: 'win', winner: 'p2', reason: 'forfeit' });
    // La question de l'attaque, levée après l'abandon, ne doit pas rester en attente.
    expect(match.state.pendingChoice).toBeUndefined();
  });
});
