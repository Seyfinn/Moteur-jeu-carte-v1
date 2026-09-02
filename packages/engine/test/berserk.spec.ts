import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type CharacterInstance, type PlayerId, type RosterConfig } from '../src/index.js';
import { berserk } from '../src/cards/demo/berserk.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let berserkRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!berserkRegistered) {
    berserkRegistered = true;
    registerCard(berserk);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: ['berserk', 'fx-heal-object'],
  terrainCardIds: [],
};

const has = (char: CharacterInstance, statusId: string) => char.statuses.some((s) => s.statusId === statusId);

async function equip(match: Awaited<ReturnType<typeof createReadyMatch>>, owner: PlayerId, wearerId: string): Promise<string> {
  const objectInstanceId = Object.values(match.state.players[owner].objects).find((o) => o.cardId === 'berserk')!
    .instanceId;
  await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
    if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
    return { kind: 'select-characters', selected: [wearerId] };
  });
  return objectInstanceId;
}

/**
 * "Berserk" est le 3e objet de ce lot à demander un ajout moteur : le seuil de HP est
 * surveillé par zones.ts::resolveBerserkVow, rappelé après tout ce qui peut faire bouger les
 * HP actuels du porteur (match.ts::dealDamage / applyValeurLock / resolveObjectInPlay). La
 * récompense (Buveur de Sang) restaure sa vie via hp.heal() en direct pour contourner son
 * propre blocage des soins externes -- voir effect-context.ts::dealDamage et match.ts::heal.
 */
describe('Berserk -- Buveur de Sang débloqué en passant sous 30 HP sans mourir', () => {
  it('déclenche la récompense sur le coup qui fait passer sous la barre, bloque les soins externes et active le lifesteal', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 31 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-striker' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    const enemyActiveId = match.state.players[enemy].activeCharacterInstanceId!;
    const enemyActive = () => match.state.players[enemy].characters[enemyActiveId]!;

    const objectInstanceId = await equip(match, owner, wearerId);
    wearer().damage = 240; // 60 HP sur 300 -- encore au-dessus des 30.
    expect(has(wearer(), 'berserk-vow')).toBe(true);

    await drive(match, owner, { kind: 'pass' });
    // Strike de fx-striker : 40 dégâts -> 20 HP restants, sous la barre, mais vivant.
    await drive(match, enemy, { kind: 'attack', characterInstanceId: enemyActiveId, attackId: 'strike' });

    expect(wearer().damage).toBe(280);
    expect(has(wearer(), 'berserk-vow')).toBe(false);
    expect(has(wearer(), 'buveur-de-sang')).toBe(true);
    expect(wearer().statuses.find((s) => s.statusId === 'buveur-de-sang')?.data?.['healPercent']).toBe(50);
    expect(wearer().attachedObjectInstanceIds).not.toContain(objectInstanceId);
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);

    // Soin externe (allié/objet) : totalement sans effet.
    const healObjectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'fx-heal-object'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId: healObjectInstanceId });
    expect(wearer().damage).toBe(280);

    // Lifesteal : "poke" inflige ~10 à l'adverse (peut critiquer, 1% de base), le porteur
    // en récupère 50 % de ce qui a réellement été infligé -- pas un chiffre figé.
    const wearerDamageBefore = wearer().damage;
    const enemyDamageBefore = enemyActive().damage;
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });
    const dealt = enemyActive().damage - enemyDamageBefore;
    expect(dealt).toBeGreaterThan(0);
    expect(wearer().damage).toBe(wearerDamageBefore - Math.round(dealt * 0.5));
  });

  it('se déclenche immédiatement si le porteur est déjà sous la barre au moment de l’équipement', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 32 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-striker' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    wearer().damage = 280; // déjà 20 HP, avant même de porter l'objet.

    const objectInstanceId = await equip(match, owner, wearerId);
    expect(has(wearer(), 'berserk-vow')).toBe(false);
    expect(has(wearer(), 'buveur-de-sang')).toBe(true);
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);
  });

  it("n'accorde rien si le coup qui passe sous la barre est mortel", async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 33 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    await equip(match, owner, wearerId);
    wearer().damage = 65; // 35 HP sur 100 -- au-dessus de la barre, vœu pas encore tenu.
    expect(has(wearer(), 'berserk-vow')).toBe(true);

    await drive(match, owner, { kind: 'pass' });
    // Strike (40) : 65 + 40 = 105 > 100 HP max -- mortel, en traversant la barre au passage.
    await drive(match, enemy, { kind: 'attack', characterInstanceId: match.state.players[enemy].activeCharacterInstanceId!, attackId: 'strike' });

    expect(match.state.players[owner].graveyardCharacterInstanceIds).toContain(wearerId);
  });
});
