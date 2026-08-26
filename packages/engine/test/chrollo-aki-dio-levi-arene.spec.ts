import { beforeAll, describe, expect, it } from 'vitest';
import {
  canSwitchAny,
  canTargetBench,
  canUseAbility,
  getCharacterCard,
  registerCard,
  type Match,
  type PendingChoice,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { chrolloLucilfer } from '../src/cards/demo/chrollo-lucilfer.js';
import { aki } from '../src/cards/demo/aki.js';
import { dioBrando } from '../src/cards/demo/dio-brando.js';
import { levi } from '../src/cards/demo/levi.js';
import { arene } from '../src/cards/demo/arene.js';
import { getCurrentHP } from '../src/hp.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [chrolloLucilfer, aki, dioBrando, levi, arene]) registerCard(card);
  }
});

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

/** Sélectionne un personnage précis dans une fenêtre de ciblage ; défaut sinon. */
function answerCharacter(instanceId: string) {
  return (choice: PendingChoice) => {
    if (choice.spec.kind === 'select-characters' && choice.spec.options.includes(instanceId)) {
      return { kind: 'select-characters' as const, selected: [instanceId] };
    }
    return defaultAnswer(choice);
  };
}

const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

describe('Dio Brando -- "Za Warudo !" : le tour bonus du moteur', () => {
  const ROSTER: RosterConfig = { characterCardIds: [dioBrando.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('rend la main au même joueur au lieu de la passer, une seule fois', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 4 },
      { p1ActiveCardId: dioBrando.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const dioId = findInstance(match, 'p1', dioBrando.id);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: dioId, abilityId: 'za-warudo' });
    expect(match.state.pendingExtraTurnFor).toBe('p1');

    // Le tour se ferme... et se rouvre pour p1.
    await drive(match, 'p1', { kind: 'pass' });
    expect(match.state.activePlayerId).toBe('p1');
    expect(match.state.pendingExtraTurnFor).toBeUndefined();

    // Le tour bonus, lui, rend bien la main : pas de chaîne infinie.
    await drive(match, 'p1', { kind: 'pass' });
    expect(match.state.activePlayerId).toBe('p2');
  });

  it("réduit de moitié l'ATK de toute l'équipe pendant le tour bonus seulement", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 4 },
      { p1ActiveCardId: dioBrando.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const dioId = findInstance(match, 'p1', dioBrando.id);
    const allyId = findInstance(match, 'p1', 'fx-tank');
    const { getEffectiveATK } = await import('../src/queries.js');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: dioId, abilityId: 'za-warudo' });
    // Le tour de lancement reste un tour normal : 100 % des dégâts.
    expect(getEffectiveATK(match.state, dioId, 50)).toBe(50);
    expect(getEffectiveATK(match.state, allyId, 50)).toBe(50);

    await drive(match, 'p1', { kind: 'pass' }); // on est maintenant dans le tour bonus
    expect(getEffectiveATK(match.state, dioId, 50)).toBe(25);
    expect(getEffectiveATK(match.state, allyId, 50)).toBe(25); // toute l'équipe, pas seulement Dio

    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(getEffectiveATK(match.state, dioId, 50)).toBe(50); // le malus n'a duré que le tour bonus
  });

  it('ferme tous les switchs pendant le tour arrêté, des deux camps', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 4 },
      { p1ActiveCardId: dioBrando.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const dioId = findInstance(match, 'p1', dioBrando.id);
    const allyId = findInstance(match, 'p1', 'fx-tank');
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;
    const foeBenchId = match.state.players.p2.benchCharacterInstanceIds[0]!;

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: dioId, abilityId: 'za-warudo' });
    // Tour de lancement : rien n'est encore figé.
    expect(canSwitchAny(match.state, 'p1', dioId, allyId).allow).toBe(true);

    await drive(match, 'p1', { kind: 'pass' }); // tour arrêté
    expect(canSwitchAny(match.state, 'p1', dioId, allyId).allow).toBe(false);
    // Y compris pour le camp d'en face, donc un `forceSwitch` de carte ne passe pas non plus.
    expect(canSwitchAny(match.state, 'p2', foeActiveId, foeBenchId).allow).toBe(false);
    expect(match.applyAction('p1', { kind: 'switch', newActiveInstanceId: allyId }).ok).toBe(false);

    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(canSwitchAny(match.state, 'p1', dioId, allyId).allow).toBe(true); // le temps repart
  });

  it('rend 30 % des dégâts portés, bouclier compris', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 4 },
      { p1ActiveCardId: dioBrando.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const dioId = findInstance(match, 'p1', dioBrando.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    match.state.players.p1.characters[dioId]!.damage = 100; // de la place pour se soigner
    // Bouclier plein sur la cible : rien ne passe en PV, le vol de vie doit compter quand même.
    match.state.players.p2.characters[foeId]!.shield = 500;

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: dioId, attackId: 'chair-vampirique' });
    expect(match.state.players.p2.characters[foeId]!.damage).toBe(0); // tout absorbé
    expect(match.state.players.p1.characters[dioId]!.damage).toBe(85); // 100 - 30% de 50
  });
});

describe('Aki -- une passive imprimée, trois events', () => {
  const ROSTER: RosterConfig = { characterCardIds: [aki.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
  const FOE_WITH_OBJECT: RosterConfig = {
    characterCardIds: ['fx-tank', 'fx-stunner'],
    objectCardIds: ['fx-heal-object'],
    terrainCardIds: [],
  };

  it("cumule +40 par objet adverse et dépense le bonus sur l'attaque d'Aki", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE_WITH_OBJECT, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    const { getEffectiveATK } = await import('../src/queries.js');

    const objectId = Object.values(match.state.players.p2.objects).find((o) => o.cardId === 'fx-heal-object')!.instanceId;
    await drive(match, 'p2', { kind: 'play-object', objectInstanceId: objectId });
    expect(getEffectiveATK(match.state, akiId, 55)).toBe(95);

    await drive(match, 'p2', { kind: 'pass' });
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: akiId, attackId: 'sabre-d-obsidienne' });
    expect(getEffectiveATK(match.state, akiId, 55)).toBe(55); // dépensé
  });

  it("stunne l'actif adverse quand l'ennemi utilise un actif", async () => {
    // fx-tank et son `self-buff`, pas fx-stunner : une capacité adverse qui stunnerait Aki
    // l'empêcherait justement de réagir (le moteur revérifie l'éligibilité d'une passive
    // juste avant de l'exécuter), et le test ne prouverait rien.
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p2');
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    await drive(match, 'p2', { kind: 'use-ability', characterInstanceId: foeId, abilityId: 'self-buff' });
    expect(match.state.players.p2.characters[foeId]!.statuses.some((s) => s.statusId === 'stun')).toBe(true);
  });

  it("soigne 20 PV quand l'ennemi attaque, sans toucher au plafond", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    match.state.players.p1.characters[akiId]!.damage = 50;
    const maxBefore = match.state.players.p1.characters[akiId]!.currentMaxHP;
    const hpBefore = getCurrentHP(match.state.players.p1.characters[akiId]!);
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'jab' });

    const self = match.state.players.p1.characters[akiId]!;
    expect(self.currentMaxHP).toBe(maxBefore); // simple soin : le plafond ne bouge pas
    // `onAttackDeclared` part avant que le coup ne soit résolu, d'où cet ordre :
    // +20 rendus, puis le jab reprend 5.
    expect(getCurrentHP(self)).toBe(hpBefore + 20 - 5);
  });

  it("ne rend rien quand Aki est déjà à pleine vie", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    const maxBefore = match.state.players.p1.characters[akiId]!.currentMaxHP;
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: foeId, attackId: 'jab' });

    const self = match.state.players.p1.characters[akiId]!;
    expect(self.currentMaxHP).toBe(maxBefore);
    expect(self.damage).toBe(5); // rien à soigner avant le coup, donc seul le jab compte
  });

  it("ne lit plus le jeu depuis le banc", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE_WITH_OBJECT, seed: 9 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    expect(match.state.players.p1.benchCharacterInstanceIds).toContain(akiId);
    const { getEffectiveATK } = await import('../src/queries.js');

    const objectId = Object.values(match.state.players.p2.objects).find((o) => o.cardId === 'fx-heal-object')!.instanceId;
    await drive(match, 'p2', { kind: 'play-object', objectInstanceId: objectId });
    expect(getEffectiveATK(match.state, akiId, 55)).toBe(55); // aucun bonus depuis le banc
  });

  it("rejoue l'objet adverse une fois, puis se referme jusqu'au prochain objet", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE_WITH_OBJECT, seed: 9 },
      { p1ActiveCardId: aki.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p2');
    const akiId = findInstance(match, 'p1', aki.id);
    const akiDef = getCharacterCard(aki.id);
    const spectre = akiDef.abilities.find((a) => a.id === 'spectre')!;

    const objectId = Object.values(match.state.players.p2.objects).find((o) => o.cardId === 'fx-heal-object')!.instanceId;
    await drive(match, 'p2', { kind: 'play-object', objectInstanceId: objectId });
    await drive(match, 'p2', { kind: 'pass' });

    match.state.players.p1.characters[akiId]!.damage = 40;
    expect(canUseAbility(match.state, akiId, spectre).allow).toBe(true);
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: akiId, abilityId: 'spectre' });
    expect(match.state.players.p1.characters[akiId]!.damage).toBe(25); // l'objet a soigné 15

    // Volé une fois : plus rien à voler tant que l'adversaire n'en pose pas un nouveau.
    const refused = match.applyAction('p1', { kind: 'use-ability', characterInstanceId: akiId, abilityId: 'spectre' });
    expect(refused.ok).toBe(false);
  });
});

describe('Levi -- "Traque" ouvre le banc affaibli', () => {
  const ROSTER: RosterConfig = { characterCardIds: [levi.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('ne propose le banc adverse que sous 60 PV actuels', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 13 },
      { p1ActiveCardId: levi.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const leviId = findInstance(match, 'p1', levi.id);
    const benchFoeId = findInstance(match, 'p2', 'fx-stunner');

    // Interrogé avec le défaut REFUSÉ : seule une voix de "Traque" peut ouvrir le banc.
    // (Avec `true`, l'absence de voix suffirait à autoriser et le test ne prouverait rien.)
    // fx-stunner a 100 PV : hors de portée.
    expect(canTargetBench(match.state, leviId, benchFoeId, false).allow).toBe(false);

    match.state.players.p2.characters[benchFoeId]!.damage = 50; // 50 PV restants
    expect(canTargetBench(match.state, leviId, benchFoeId, false).allow).toBe(true);

    await drive(
      match,
      'p1',
      { kind: 'attack', characterInstanceId: leviId, attackId: 'taillade-eclair' },
      answerCharacter(benchFoeId)
    );
    expect(match.state.players.p2.characters[benchFoeId]!.damage).toBeGreaterThan(50);
  });
});

describe('Arène -- isolement du poste actif', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['fx-striker', 'fx-tank'],
    objectCardIds: [],
    terrainCardIds: [arene.id],
  };

  async function playArena(match: Match, playerId: PlayerId): Promise<void> {
    const terrainId = Object.values(match.state.players[playerId].terrains).find((t) => t.cardId === arene.id)!.instanceId;
    await drive(match, playerId, { kind: 'play-terrain', terrainInstanceId: terrainId });
  }

  it('ferme les switchs des DEUX camps, y compris forcés, et coupe les soins du banc', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 17 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    await playArena(match, 'p1');

    const myBenchId = match.state.players.p1.benchCharacterInstanceIds[0]!;
    const foeBenchId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    expect(canSwitchAny(match.state, 'p1', match.state.players.p1.activeCharacterInstanceId, myBenchId).allow).toBe(false);
    expect(canSwitchAny(match.state, 'p2', match.state.players.p2.activeCharacterInstanceId, foeBenchId).allow).toBe(false);

    // Le switch est refusé à l'entrée, le joueur ne perd pas son tour pour rien.
    const refused = match.applyAction('p1', { kind: 'switch', newActiveInstanceId: myBenchId });
    expect(refused.ok).toBe(false);

    // Un soin visant le banc ne rend plus rien.
    match.state.players.p1.characters[myBenchId]!.damage = 60;
    const { evaluateTransform } = await import('../src/queries.js');
    expect(evaluateTransform(match.state, 'getIncomingHealAmount', { targetInstanceId: myBenchId }, 30)).toBe(0);
    // ... alors que l'actif se soigne normalement.
    const activeId = match.state.players.p1.activeCharacterInstanceId!;
    expect(evaluateTransform(match.state, 'getIncomingHealAmount', { targetInstanceId: activeId }, 30)).toBe(30);
  });

  it('laisse toujours un KO remettre quelqu\'un au poste actif', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 17 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    await playArena(match, 'p1');

    // On tue l'actif adverse : le remplacement n'est pas un switch, il doit passer.
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;
    const foeBenchId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: match.state.players.p1.activeCharacterInstanceId!, abilityId: 'instant-ko' });

    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(foeActiveId);
    expect(match.state.players.p2.activeCharacterInstanceId).toBe(foeBenchId);
  });

  it('majore de 30 % les dégâts entre les deux actifs, et seulement ceux-là', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 17 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    await playArena(match, 'p1');

    const myActiveId = match.state.players.p1.activeCharacterInstanceId!;
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;
    const foeBenchId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    const { evaluateTransform } = await import('../src/queries.js');

    expect(
      evaluateTransform(match.state, 'getIncomingDamageAmount', { targetInstanceId: foeActiveId, attackerInstanceId: myActiveId }, 100)
    ).toBe(130);
    // Un coup dirigé vers le banc n'est pas ce duel-là (et de toute façon le banc est isolé).
    expect(
      evaluateTransform(match.state, 'getIncomingDamageAmount', { targetInstanceId: foeBenchId, attackerInstanceId: myActiveId }, 100)
    ).toBe(100);
  });
});

describe('Chrollo Lucilfer -- le livre', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: [chrolloLucilfer.id, 'fx-tank'],
    objectCardIds: [],
    terrainCardIds: [],
  };

  it("scelle l'actif adverse, le renvoie au banc, et lui interdit de remonter par un switch", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 23 },
      { p1ActiveCardId: chrolloLucilfer.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p1');
    const chrolloId = findInstance(match, 'p1', chrolloLucilfer.id);
    const victimId = match.state.players.p2.activeCharacterInstanceId!;

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'double-face-annulation' });

    expect(match.state.players.p2.benchCharacterInstanceIds).toContain(victimId);
    expect(match.state.players.p2.activeCharacterInstanceId).not.toBe(victimId);
    expect(match.state.players.p2.characters[victimId]!.statuses.some((s) => s.statusId === 'chrollo-scellement')).toBe(true);

    // Scellée : ni capacité, ni retour au poste actif.
    const victimDef = getCharacterCard(match.state.players.p2.characters[victimId]!.cardId);
    expect(canUseAbility(match.state, victimId, victimDef.abilities[0]!).allow).toBe(false);
    expect(canSwitchAny(match.state, 'p2', match.state.players.p2.activeCharacterInstanceId, victimId).allow).toBe(false);

    // Chrollo frappe désormais avec l'attaque volée (jab, 5 ATK) et non sa Dague (45).
    const foeActive = match.state.players.p2.activeCharacterInstanceId!;
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: chrolloId, attackId: 'dague-de-ben' });
    expect(match.state.players.p2.characters[foeActive]!.damage).toBe(5);
  });

  it('saigne Chrollo de 25 % au début de son tour sans jamais le tuer, et Fermeture rend tout', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 23 },
      { p1ActiveCardId: chrolloLucilfer.id, p2ActiveCardId: 'fx-stunner' }
    );
    await ensureTurn(match, 'p1');
    const chrolloId = findInstance(match, 'p1', chrolloLucilfer.id);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'double-face-annulation' });
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    // Début du tour de Chrollo : 25 % de 225 = 56.
    expect(match.state.players.p1.characters[chrolloId]!.damage).toBe(56);

    // À 3 PV, 25 % arrondi au plancher vaut 0 : la saignée ne peut pas achever Chrollo.
    match.state.players.p1.characters[chrolloId]!.damage = 222;
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(match.state.players.p1.characters[chrolloId]!.damage).toBe(222);
    expect(match.state.players.p1.graveyardCharacterInstanceIds).not.toContain(chrolloId);

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: chrolloId, abilityId: 'fermeture-du-livre' });
    const victimId = match.state.players.p2.benchCharacterInstanceIds.find(
      (id) => match.state.players.p2.characters[id]!.cardId === 'fx-stunner'
    )!;
    expect(match.state.players.p2.characters[victimId]!.statuses.some((s) => s.statusId === 'chrollo-scellement')).toBe(false);

    // Plus de saignée, et la Dague de Ben est de retour (45 sur l'actif adverse).
    const damageAfterClose = match.state.players.p1.characters[chrolloId]!.damage;
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(match.state.players.p1.characters[chrolloId]!.damage).toBe(damageAfterClose);
  });
});
