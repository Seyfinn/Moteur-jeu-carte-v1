import { beforeAll, describe, expect, it } from 'vitest';
import {
  DRAW_MODE_BENCH_SIZE,
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_HAND_FULL_MESSAGE,
  DRAW_MODE_MAX_CHARACTER_HAND,
  DRAW_MODE_STARTING_CHARACTERS,
  checkWinCondition,
  createRng,
  getCharacterCard,
  getPlayerView,
  listDeckPool,
  registerDemoCards,
  type Match,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { buildCharacterPile, buildObjectPile, buildSharedTerrainPile, instantiateCharacter } from '../src/draw-mode.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerDemoCards();
});

/** En Mode Pioche les rosters sont ignorés : tout sort des piles. */
const NO_ROSTER: RosterConfig = { characterCardIds: [], objectCardIds: [], terrainCardIds: [] };

async function newDrawMatch(seed: number): Promise<Match> {
  return createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: NO_ROSTER, p2Roster: NO_ROSTER, seed, mode: 'draw' });
}

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) await drive(match, match.state.activePlayerId, { kind: 'pass' });
}

/** Termine le tour de `playerId`, puis rend la main à l'adversaire pour revenir à lui. */
async function passFullRound(match: Match, playerId: PlayerId): Promise<void> {
  await ensureTurn(match, playerId);
  await drive(match, playerId, { kind: 'pass' });
  if (match.state.result) return;
  await drive(match, match.state.activePlayerId, { kind: 'pass' });
}

describe('Mode Pioche -- les piles', () => {
  it('met TOUT le catalogue de personnages dans la pile, sans doublon', () => {
    const all = listDeckPool().filter((e) => e.type === 'character').map((e) => e.id);
    const pile = buildCharacterPile(createRng(7));
    // Aucun doublon dans la pile = « tous tirés avant qu'un doublon ne réapparaisse ».
    expect(new Set(pile).size).toBe(pile.length);
    expect([...pile].sort()).toEqual([...all].sort());
  });

  it("respecte le maxCopies de chaque objet, et n'admet qu'un exemplaire par terrain", () => {
    const objectPile = buildObjectPile(createRng(7));
    for (const entry of listDeckPool()) {
      if (entry.type !== 'object') continue;
      expect(objectPile.filter((id) => id === entry.id)).toHaveLength(entry.maxCopies);
    }

    const terrainPile = buildSharedTerrainPile(createRng(7));
    expect(new Set(terrainPile).size).toBe(terrainPile.length);
  });

  it('exclut les formes évoluées des trois piles', () => {
    const selectable = new Set(listDeckPool().map((e) => e.id));
    for (const pile of [buildCharacterPile(createRng(3)), buildObjectPile(createRng(3)), buildSharedTerrainPile(createRng(3))]) {
      for (const id of pile) expect(selectable.has(id)).toBe(true);
    }
  });
});

describe('Mode Pioche -- mise en place', () => {
  it('ouvre sur 3 personnages (1 actif + 2 au banc) et une main vide', async () => {
    const match = await newDrawMatch(11);

    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      const player = match.state.players[playerId];
      expect(Object.keys(player.characters)).toHaveLength(DRAW_MODE_STARTING_CHARACTERS);
      expect(player.activeCharacterInstanceId).not.toBeNull();
      expect(player.benchCharacterInstanceIds).toHaveLength(DRAW_MODE_BENCH_SIZE);
      // « Les joueurs commencent la partie avec 0 carte en main. »
      expect(player.unplayedObjectInstanceIds).toHaveLength(0);
      expect(player.unplayedTerrainInstanceIds).toHaveLength(0);
      expect(player.handCharacterInstanceIds).toHaveLength(0);
      // Les 3 de départ sortent de la pile, donc ils n'y sont plus.
      const catalogue = listDeckPool().filter((e) => e.type === 'character').length;
      expect(player.drawPiles.characterCardIds).toHaveLength(catalogue - DRAW_MODE_STARTING_CHARACTERS);
    }

    // Piles personnelles pour les personnages : les deux camps tirent indépendamment.
    expect(match.state.players.p1.drawPiles.characterCardIds).not.toEqual(
      match.state.players.p2.drawPiles.characterCardIds
    );
    expect(match.state.sharedTerrainPile.length).toBeGreaterThan(0);
  });
});

describe('Mode Pioche -- cycle de pioche', () => {
  it('pioche objet, puis terrain, puis personnage, à chaque fin de tour', async () => {
    const match = await newDrawMatch(13);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    await drive(match, me, { kind: 'pass' }); // fin de mon 1er tour -> objet
    expect(player.unplayedObjectInstanceIds).toHaveLength(1);
    expect(player.unplayedTerrainInstanceIds).toHaveLength(0);

    await drive(match, match.state.activePlayerId, { kind: 'pass' });
    await drive(match, me, { kind: 'pass' }); // 2e tour -> terrain
    expect(player.unplayedTerrainInstanceIds).toHaveLength(1);
    expect(player.unplayedObjectInstanceIds).toHaveLength(1);

    await drive(match, match.state.activePlayerId, { kind: 'pass' });
    const charsBefore = Object.keys(player.characters).length;
    await drive(match, me, { kind: 'pass' }); // 3e tour -> personnage
    expect(Object.keys(player.characters).length).toBe(charsBefore + 1);

    await drive(match, match.state.activePlayerId, { kind: 'pass' });
    await drive(match, me, { kind: 'pass' }); // 4e tour -> on repart sur un objet
    expect(player.unplayedObjectInstanceIds).toHaveLength(2);
  });

  it('a un compteur propre à chaque joueur', async () => {
    const match = await newDrawMatch(17);
    const first = match.state.activePlayerId;
    const second = first === 'p1' ? 'p2' : 'p1';

    await drive(match, first, { kind: 'pass' });
    // Le second n'a pas encore fini de tour : il n'a rien pioché.
    expect(match.state.players[second].unplayedObjectInstanceIds).toHaveLength(0);
    expect(match.state.players[first].unplayedObjectInstanceIds).toHaveLength(1);

    await drive(match, second, { kind: 'pass' });
    // ... et il démarre bien son cycle à lui, par un objet.
    expect(match.state.players[second].unplayedObjectInstanceIds).toHaveLength(1);
    expect(match.state.players[second].drawCycleIndex).toBe(1);
  });

  it('vide la pile de terrains pour les DEUX joueurs (pile commune)', async () => {
    const match = await newDrawMatch(19);
    const me = match.state.activePlayerId;
    const before = [...match.state.sharedTerrainPile];

    await passFullRound(match, me); // tour 1 des deux : objet chacun
    await ensureTurn(match, me);
    await drive(match, me, { kind: 'pass' }); // mon tour 2 : terrain

    const drawn = match.state.players[me].unplayedTerrainInstanceIds[0]!;
    const drawnCardId = match.state.players[me].terrains[drawn]!.cardId;
    expect(before).toContain(drawnCardId);
    // Retiré de la pile commune : l'adversaire ne pourra plus jamais le piocher.
    expect(match.state.sharedTerrainPile).not.toContain(drawnCardId);
    expect(match.state.sharedTerrainPile).toHaveLength(before.length - 1);
  });
});

describe('Mode Pioche -- banc, Main Personnage et secours', () => {
  it('envoie en Main Personnage un personnage pioché banc plein, puis comble le banc libéré', async () => {
    const match = await newDrawMatch(23);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // Banc déjà plein (2/2) : on force une pioche personnage tout de suite.
    player.drawCycleIndex = 2;
    expect(player.benchCharacterInstanceIds).toHaveLength(DRAW_MODE_BENCH_SIZE);
    await drive(match, me, { kind: 'pass' });

    expect(player.handCharacterInstanceIds).toHaveLength(1);
    expect(player.benchCharacterInstanceIds).toHaveLength(DRAW_MODE_BENCH_SIZE);
    const inHand = player.handCharacterInstanceIds[0]!;

    // Une place se libère au banc -> la main doit la combler immédiatement, sans attendre.
    const leaving = player.benchCharacterInstanceIds[0]!;
    player.benchCharacterInstanceIds = player.benchCharacterInstanceIds.filter((id) => id !== leaving);
    await ensureTurn(match, me);
    await drive(match, me, { kind: 'pass' });

    expect(player.benchCharacterInstanceIds).toContain(inHand);
    expect(player.handCharacterInstanceIds).toHaveLength(0);
  });

  it('fait arriver un personnage en secours quand le dernier actif meurt', async () => {
    const match = await newDrawMatch(47);
    const attacker = match.state.activePlayerId;
    const defender: PlayerId = attacker === 'p1' ? 'p2' : 'p1';
    const attackerActive = match.state.players[attacker].activeCharacterInstanceId!;
    // Whichever character the draw pile hands the attacker might not deal damage on its
    // own attack (e.g. Yumeko's "Mise a Fond" is 0 ATK until a separate bet is won) --
    // swap in a known, reliably-damaging attacker. The point of this test is the rescue
    // mechanic that fires on KO, not a specific matchup. A raw `api.dealDamage` call would
    // dodge this, but it can't safely trigger the mandatory-replacement choice below: that
    // choice can only be answered by code running *after* the same internal await, so
    // calling it outside the normal action path (`drive`) would deadlock.
    match.state.players[attacker].characters[attackerActive]!.cardId = 'guts';
    const attackId = getCharacterCard('guts').attacks[0]!.id;

    // Le défenseur n'a plus que son actif : ni banc, ni Main Personnage.
    const victim = match.state.players[defender];
    for (const id of victim.benchCharacterInstanceIds) delete victim.characters[id];
    victim.benchCharacterInstanceIds = [];
    victim.handCharacterInstanceIds = [];
    const lastOne = victim.activeCharacterInstanceId!;
    const pileBefore = victim.drawPiles.characterCardIds.length;

    for (let i = 0; i < 12 && victim.activeCharacterInstanceId === lastOne; i++) {
      const current = victim.characters[lastOne];
      if (current) current.damage = current.currentMaxHP - 1;
      if (match.state.activePlayerId === attacker) {
        await drive(match, attacker, { kind: 'attack', characterInstanceId: attackerActive, attackId });
      } else {
        await drive(match, match.state.activePlayerId, { kind: 'pass' });
      }
    }

    expect(victim.graveyardCharacterInstanceIds).toContain(lastOne);
    // Secours : un personnage tout neuf sorti de la pile occupe le poste actif.
    expect(victim.activeCharacterInstanceId).not.toBeNull();
    expect(victim.activeCharacterInstanceId).not.toBe(lastOne);
    expect(victim.drawPiles.characterCardIds.length).toBeLessThan(pileBefore);
    expect(match.state.result).toBeUndefined(); // et surtout : pas de défaite
  });

  it("ne déclare PAS perdant un camp vidé de ses personnages, et le secourt", async () => {
    const match = await newDrawMatch(29);
    const victim: PlayerId = match.state.activePlayerId === 'p1' ? 'p2' : 'p1';
    const player = match.state.players[victim];

    // On vide tout : plus d'actif, plus de banc, plus de main.
    player.activeCharacterInstanceId = null;
    player.benchCharacterInstanceIds = [];
    player.handCharacterInstanceIds = [];

    checkWinCondition(match.state);
    // La défaite par plateau vide est désactivée dans ce mode.
    expect(match.state.result).toBeUndefined();
  });
});

describe('Mode Pioche -- épuisement et recyclage des piles', () => {
  it('recycle le cimetière quand la pile de terrains est vide', async () => {
    const match = await newDrawMatch(41);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // Pile commune à sec, mais un terrain traîne au cimetière : il doit revenir.
    match.state.sharedTerrainPile = [];
    const recycledCardId = listDeckPool().find((e) => e.type === 'terrain')!.id;
    const instanceId = 'terrain-au-cimetiere';
    player.terrains[instanceId] = { instanceId, cardId: recycledCardId, ownerId: me };
    player.graveyardTerrainInstanceIds = [instanceId];

    player.drawCycleIndex = 1; // prochaine pioche = terrain
    await drive(match, me, { kind: 'pass' });

    expect(player.graveyardTerrainInstanceIds).toHaveLength(0); // le cimetière a été consommé
    expect(player.unplayedTerrainInstanceIds).toHaveLength(1);
    const drawn = player.unplayedTerrainInstanceIds[0]!;
    expect(player.terrains[drawn]!.cardId).toBe(recycledCardId);
  });

  it("saute la pioche, sans casser, quand il n'y a vraiment rien à mélanger", async () => {
    const match = await newDrawMatch(43);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    match.state.sharedTerrainPile = [];
    match.state.players.p1.graveyardTerrainInstanceIds = [];
    match.state.players.p2.graveyardTerrainInstanceIds = [];

    player.drawCycleIndex = 1;
    await drive(match, me, { kind: 'pass' });

    expect(player.unplayedTerrainInstanceIds).toHaveLength(0);
    // Le tour a bien consommé son tirage : le cycle avance malgré la pioche sautée.
    expect(player.drawCycleIndex).toBe(2);
    expect(match.state.result).toBeUndefined();
  });
});

describe('Mode Pioche -- limite de la Main Personnage', () => {
  it('saute la pioche sans entamer la pile quand la main est pleine', async () => {
    const match = await newDrawMatch(59);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // Main pleine (5), banc plein (2) : au total 8 personnages, dont 3 sur le plateau.
    for (let i = 0; i < DRAW_MODE_MAX_CHARACTER_HAND; i++) {
      const cardId = player.drawPiles.characterCardIds.pop()!;
      const char = instantiateCharacter(me, cardId);
      player.characters[char.instanceId] = char;
      player.handCharacterInstanceIds.push(char.instanceId);
    }
    const pileBefore = player.drawPiles.characterCardIds.length;
    const charsBefore = Object.keys(player.characters).length;

    player.drawCycleIndex = 2; // prochaine pioche = personnage
    await drive(match, me, { kind: 'pass' });

    // Rien pioché, et surtout la pile n'a pas été entamée : la carte reste dessus.
    expect(player.handCharacterInstanceIds).toHaveLength(DRAW_MODE_MAX_CHARACTER_HAND);
    expect(player.drawPiles.characterCardIds).toHaveLength(pileBefore);
    expect(Object.keys(player.characters).length).toBe(charsBefore);
    // Le message annoncé au joueur est bien celui demandé.
    expect(match.state.log.some((e) => e.message.includes(DRAW_MODE_HAND_FULL_MESSAGE))).toBe(true);
    // Le tour a consommé son tirage : le cycle repart sur un objet.
    expect(player.drawCycleIndex).toBe(0);
  });

  it('ne compte QUE la main : les 3 personnages du plateau sont hors plafond', async () => {
    const match = await newDrawMatch(61);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // 4 en main (sous le plafond) + les 3 du plateau = 7 personnages : la pioche passe.
    for (let i = 0; i < DRAW_MODE_MAX_CHARACTER_HAND - 1; i++) {
      const cardId = player.drawPiles.characterCardIds.pop()!;
      const char = instantiateCharacter(me, cardId);
      player.characters[char.instanceId] = char;
      player.handCharacterInstanceIds.push(char.instanceId);
    }
    expect(Object.keys(player.characters).length).toBe(DRAW_MODE_STARTING_CHARACTERS + 4);

    player.drawCycleIndex = 2;
    await drive(match, me, { kind: 'pass' });

    expect(player.handCharacterInstanceIds).toHaveLength(DRAW_MODE_MAX_CHARACTER_HAND);
  });
});

describe('Mode Pioche -- secret des piles et de la Main Personnage', () => {
  it("ne nomme pas dans le journal un personnage pioché en main (le journal est commun)", async () => {
    const match = await newDrawMatch(67);
    const me = match.state.activePlayerId;
    const player = match.state.players[me];

    // Banc plein : la prochaine pioche personnage part en Main Personnage, donc au secret.
    const nextCardId = player.drawPiles.characterCardIds.at(-1)!;
    const secretName = getCharacterCard(nextCardId).name;
    player.drawCycleIndex = 2;
    await drive(match, me, { kind: 'pass' });

    expect(player.handCharacterInstanceIds).toHaveLength(1);
    // Le journal est diffusé aux DEUX joueurs : il ne doit pas dire ce que la vue caviarde.
    expect(match.state.log.some((e) => e.message.includes(secretName))).toBe(false);
  });

  it("ne révèle ni l'ordre des piles ni les personnages en main adverse", async () => {
    const match = await newDrawMatch(53);
    const me = match.state.activePlayerId;
    const foe: PlayerId = me === 'p1' ? 'p2' : 'p1';

    // On met un personnage en Main Personnage adverse.
    const foeState = match.state.players[foe];
    const hidden = foeState.benchCharacterInstanceIds.pop()!;
    foeState.handCharacterInstanceIds.push(hidden);
    const secretCardId = foeState.characters[hidden]!.cardId;

    const view = getPlayerView(match.state, me);

    // La main adverse : le nombre est public, les identités non.
    expect(view.players[foe].handCharacterInstanceIds).toHaveLength(1);
    expect(view.players[foe].handCharacterInstanceIds).not.toContain(hidden);
    expect(view.players[foe].characters[hidden]).toBeUndefined();
    expect(JSON.stringify(view.players[foe].characters)).not.toContain(secretCardId);

    // Les piles : ni la sienne, ni celle d'en face, ni la commune ne disent leur ordre.
    const realNext = match.state.players[me].drawPiles.characterCardIds.at(-1)!;
    expect(view.players[me].drawPiles.characterCardIds).not.toContain(realNext);
    expect(view.players[me].drawPiles.characterCardIds).toHaveLength(
      match.state.players[me].drawPiles.characterCardIds.length
    );
    expect(view.sharedTerrainPile).not.toContain(match.state.sharedTerrainPile.at(-1));
    expect(view.sharedTerrainPile).toHaveLength(match.state.sharedTerrainPile.length);
  });
});

describe('Mode Pioche -- victoire aux 7 éliminations', () => {
  it('donne la victoire dès que le camp adverse a perdu 7 personnages', async () => {
    const match = await newDrawMatch(31);

    match.state.players.p2.charactersLost = DRAW_MODE_ELIMINATIONS_TO_WIN - 1;
    checkWinCondition(match.state);
    expect(match.state.result).toBeUndefined();

    match.state.players.p2.charactersLost = DRAW_MODE_ELIMINATIONS_TO_WIN;
    checkWinCondition(match.state);
    expect(match.state.result).toEqual({ kind: 'win', winner: 'p1' });
  });

  it('compte réellement les morts, sans reculer, en passant par le moteur', async () => {
    const match = await newDrawMatch(37);
    const attacker = match.state.activePlayerId;
    const defender: PlayerId = attacker === 'p1' ? 'p2' : 'p1';
    const attackerActive = match.state.players[attacker].activeCharacterInstanceId!;
    const attackId = getCharacterCard(match.state.players[attacker].characters[attackerActive]!.cardId).attacks[0]!.id;

    const target = match.state.players[defender].activeCharacterInstanceId!;
    expect(match.state.players[defender].charactersLost).toBe(0);

    // À 1 PV, n'importe quelle attaque tue -- sauf esquive, d'où la boucle.
    for (let i = 0; i < 12 && match.state.players[defender].charactersLost === 0; i++) {
      const current = match.state.players[defender].characters[target];
      if (current) current.damage = current.currentMaxHP - 1;
      if (match.state.activePlayerId === attacker) {
        await drive(match, attacker, { kind: 'attack', characterInstanceId: attackerActive, attackId });
      } else {
        await drive(match, match.state.activePlayerId, { kind: 'pass' });
      }
    }

    expect(match.state.players[defender].charactersLost).toBe(1);
    expect(match.state.players[defender].graveyardCharacterInstanceIds).toContain(target);
    // Le camp touché a immédiatement un nouvel actif : promotion depuis le banc.
    expect(match.state.players[defender].activeCharacterInstanceId).not.toBeNull();
  });
});
