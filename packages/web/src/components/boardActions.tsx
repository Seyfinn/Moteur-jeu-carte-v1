import type { ReactNode } from 'react';
import {
  attacksAvailableTo,
  canAttack,
  canAttackFromBench,
  canPlayObject,
  canPlayTerrain,
  canSwitchAny,
  canSwitchStandard,
  canUseAbility,
  describeDenials,
  describeObjectUnplayable,
  describeRecycleUnavailable,
  getAbilityUsesPerGame,
  getAbilityUsesPerTurn,
  getCharacterCard,
  getEffectiveATK,
  getObjectCard,
  getTerrainCard,
  memberConditionHolds,
  type AbilityDef,
  type AttackDef,
  type CharacterInstance,
  type GameState,
  type PlayerId,
  type Vote,
} from 'engine';
import type { GameConnection } from '../net/useGameConnection';

export function objectName(cardId: string): string {
  try {
    return getObjectCard(cardId).name;
  } catch {
    return cardId;
  }
}

export function terrainName(cardId: string): string {
  try {
    return getTerrainCard(cardId).name;
  } catch {
    return cardId;
  }
}

/** Un objet posé sur un personnage, tel que le plateau doit l'afficher à côté de lui. */
export interface AttachedObjectView {
  instanceId: string;
  cardId: string;
  name: string;
}

/**
 * Les objets liés à un personnage. Ils sont cherchés dans les **deux** camps : le moteur
 * autorise explicitement d'équiper un personnage adverse, donc l'objet n'appartient pas
 * forcément au propriétaire de la carte sur laquelle il est posé.
 */
export function attachedObjectsOf(state: GameState, char: CharacterInstance): AttachedObjectView[] {
  const views: AttachedObjectView[] = [];
  for (const instanceId of char.attachedObjectInstanceIds) {
    const obj = state.players.p1.objects[instanceId] ?? state.players.p2.objects[instanceId];
    if (!obj) continue; // caviardé pour ce joueur : rien à montrer plutôt qu'une carte fantôme
    views.push({ instanceId, cardId: obj.cardId, name: objectName(obj.cardId) });
  }
  return views;
}

/** Une attaque telle qu'elle frappe *maintenant* : sa valeur imprimée et sa valeur réelle. */
export interface AttackReadout {
  id: string;
  name: string;
  /** Ce qui est écrit sur la carte. */
  base: number;
  /** Ce qui sera réellement infligé : buffs, debuffs, auras de terrain et passives cumulatives compris. */
  effective: number;
}

/**
 * ATK réel d'une attaque. Le client interroge le moteur exactement comme le serveur le
 * fera au moment de résoudre le coup ; si la vue caviardée ne suffit pas à résoudre la
 * requête, on retombe sur la valeur imprimée plutôt que d'afficher n'importe quoi.
 */
export function effectiveATK(state: GameState, characterInstanceId: string, baseATK: number): number {
  try {
    return getEffectiveATK(state, characterInstanceId, baseATK);
  } catch {
    return baseATK;
  }
}

/**
 * Les attaques qu'un personnage en jeu peut réellement déclarer : celles de sa carte, plus
 * celle qu'il a empruntée ("Livre de Chrollo"). Même point d'entrée que le serveur -- lire
 * `getCharacterCard(...).attacks` en direct raterait l'empruntée, qui est justement la
 * seule que le moteur autoriserait alors.
 */
export function liveAttacks(state: GameState, characterInstanceId: string): AttackDef[] {
  try {
    return attacksAvailableTo(state, characterInstanceId);
  } catch {
    return []; // vue caviardée : mieux vaut ne rien proposer qu'une action que le serveur refuserait
  }
}

/**
 * Les attaques d'un personnage en jeu, avec les deux nombres. Sert autant au panneau de
 * commandes qu'à la fiche et à la carte : les cartes à dégâts évolutifs (Guts, Hulk,
 * Mundo, Sukuna sous Autel...) affichent une valeur imprimée qui n'est plus la bonne dès
 * le deuxième tour, et le joueur n'avait aucun moyen de lire la vraie.
 */
export function attackReadouts(state: GameState, char: CharacterInstance): AttackReadout[] {
  return liveAttacks(state, char.instanceId).map((attack) => ({
    id: attack.id,
    name: attack.name,
    base: attack.baseATK,
    effective: effectiveATK(state, char.instanceId, attack.baseATK),
  }));
}

export function characterName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

/**
 * Pastille d'information sous une option (« 1×/partie », « termine le tour »...). `state`
 * ne change que la couleur : `spent` = quota consommé, `warn` = à savoir avant de cliquer.
 */
export interface ActionTag {
  text: string;
  state?: 'spent' | 'warn';
}

/** Une entrée du panneau de commandes (une attaque, une capacité, une cible de switch). */
export interface ActionOption {
  key: string;
  label: string;
  /** Chiffre-clé affiché à droite du libellé (ATK effectif, PV de la cible...). */
  detail?: string;
  /** Précision sous le chiffre-clé (« base 40 » quand l'ATK effectif s'en écarte). */
  detailNote?: string;
  /** Sens de l'écart entre le chiffre-clé et sa valeur imprimée : colore le chiffre. */
  trend?: 'up' | 'down';
  /** Sous-titre discret sous le libellé (le personnage qui porte la capacité). */
  sub?: string;
  /**
   * Texte imprimé de la carte, affiché tel quel sous l'option (`white-space: pre-line`).
   * C'est ce qui permet de lire une attaque sans survol -- le tactile n'en a pas.
   */
  description?: string;
  tags?: ActionTag[];
  hover?: { title: string; subtitle?: string; body: ReactNode };
  /** Non-null quand le moteur refuserait l'action maintenant -- l'option est grisée avec sa raison. */
  disabledReason?: string | null;
  run: () => void;
}

/**
 * Les mêmes requêtes de permission que celles du serveur, pour griser une action avec sa
 * raison au lieu de la laisser rebondir en erreur. Évaluées sur la vue caviardée du
 * joueur : une requête qui n'arrive pas à se résoudre côté client doit retomber sur
 * « autorisé » (le serveur reste l'autorité) plutôt que casser le plateau.
 */
export function denialOf(evaluate: () => { allow: boolean; votes: Vote[] }): string | null {
  try {
    const result = evaluate();
    return result.allow ? null : describeDenials(result.votes) || 'action impossible';
  } catch {
    return null;
  }
}

/** Un personnage du banc à qui une carte ouvre l'attaque ("Bonus" de Yumeko). */
function canAttackFromBenchSafe(state: GameState, characterInstanceId: string): boolean {
  try {
    return canAttackFromBench(state, characterInstanceId).allow;
  } catch {
    return false; // vue caviardée : on n'invente pas une action que le serveur refuserait
  }
}

/**
 * Le `condition()` d'une attaque/capacité, joué à blanc sur la vue du joueur.
 *
 * Les requêtes de permission (`canAttack`, `canUseAbility`) ne le voient pas : une carte
 * dont une attaque est fermée par sa seule condition (les quatre cycles d'Escanor, dont un
 * seul est ouvert à la fois) apparaissait donc entièrement jouable, et le serveur renvoyait
 * « Conditions non remplies » à chaque clic.
 */
function conditionDenial(state: GameState, characterInstanceId: string, member: { condition?: unknown }): string | null {
  try {
    return memberConditionHolds(state, characterInstanceId, member as never) ? null : 'conditions non remplies';
  } catch {
    return null; // le serveur reste l'autorité
  }
}

export function attackOptions(state: GameState, you: PlayerId, conn: GameConnection): ActionOption[] {
  const player = state.players[you];
  const attackerIds = [
    ...(player.activeCharacterInstanceId ? [player.activeCharacterInstanceId] : []),
    ...player.benchCharacterInstanceIds.filter((id) => canAttackFromBenchSafe(state, id)),
  ];

  return attackerIds.flatMap((attackerId) => {
    const char = player.characters[attackerId];
    if (!char) return [];
    const def = getCharacterCard(char.cardId);
    const benched = player.activeCharacterInstanceId !== attackerId;

    return liveAttacks(state, attackerId).map((attack) => {
      // ATK effectif, pas la valeur imprimée : buffs, debuffs et passives cumulatives
      // atterrissent ici, et le joueur n'avait aucun moyen de voir le nombre qu'il allait
      // réellement infliger.
      const effective = effectiveATK(state, attackerId, attack.baseATK);
      const shifted = effective !== attack.baseATK;
      const suffix = shifted ? ` (base ${attack.baseATK})` : '';
      const tags: ActionTag[] = [];
      // Une attaque ferme le tour par défaut : seule l'exception mérite d'être annoncée.
      // Un `endsTurn` fonction dépend du déroulé du coup, on ne promet rien à sa place.
      if (attack.endsTurn === false) tags.push({ text: 'ne termine pas le tour' });
      if (benched) tags.push({ text: 'depuis le banc', state: 'warn' });
      return {
        key: `${attackerId}:${attack.id}`,
        label: attack.name,
        detail: `${effective} ATK`,
        detailNote: shifted ? `base ${attack.baseATK}` : undefined,
        trend: shifted ? (effective > attack.baseATK ? 'up' : 'down') : undefined,
        // Refus évalué attaque par attaque : un sceau ("Sacrifice" de Makima) n'en ferme
        // qu'une, les autres doivent rester jouables.
        disabledReason:
          denialOf(() => canAttack(state, attackerId, attack.id)) ?? conditionDenial(state, attackerId, attack),
        sub: benched ? def.name : undefined,
        description: attack.description,
        tags,
        hover: { title: attack.name, subtitle: `${effective} ATK${suffix}`, body: <p>{attack.description}</p> },
        run: () => conn.applyAction({ kind: 'attack', characterInstanceId: attackerId, attackId: attack.id }),
      };
    });
  });
}

/**
 * Les quotas d'une capacité, tels que le moteur les compte (`canUseAbility` lit les mêmes
 * requêtes) : « 1×/tour », « 1×/partie », et ce qu'il en reste. Sans ça, le joueur ne
 * savait qu'un ultime était à usage unique qu'au moment où il se grisait pour de bon.
 */
function abilityUsageTags(state: GameState, char: CharacterInstance, ability: AbilityDef): ActionTag[] {
  const tags: ActionTag[] = [];
  const perGame = safeLimit(
    () => getAbilityUsesPerGame(state, char.instanceId, ability.id, ability.usesPerGame),
    ability.usesPerGame
  );
  if (perGame !== undefined) {
    const left = Math.max(0, perGame - (char.abilityUsesThisGame[ability.id] ?? 0));
    tags.push({
      text: perGame === 1 ? (left === 0 ? '1×/partie · utilisée' : '1×/partie') : `${left}/${perGame} par partie`,
      state: left === 0 ? 'spent' : undefined,
    });
  }
  const perTurn = safeLimit(
    () => getAbilityUsesPerTurn(state, char.instanceId, ability.id, ability.usesPerTurn ?? 1),
    ability.usesPerTurn ?? 1
  );
  const leftTurn = Math.max(0, perTurn - (char.abilityUsesThisTurn[ability.id] ?? 0));
  tags.push({
    text: perTurn === 1 ? (leftTurn === 0 ? '1×/tour · utilisée' : '1×/tour') : `${leftTurn}/${perTurn} ce tour`,
    state: leftTurn === 0 ? 'spent' : undefined,
  });
  return tags;
}

/** Une requête de quota jouée sur la vue caviardée : en cas d'échec, la valeur imprimée. */
function safeLimit<T>(evaluate: () => T, fallback: T): T {
  try {
    return evaluate();
  } catch {
    return fallback;
  }
}

/** Capacités activables manuellement portées par UN personnage (actif ou de réserve). */
export function abilityOptionsFor(
  state: GameState,
  you: PlayerId,
  conn: GameConnection,
  characterInstanceId: string
): ActionOption[] {
  const player = state.players[you];
  const char = player.characters[characterInstanceId];
  if (!char) return [];
  const benched = player.activeCharacterInstanceId !== characterInstanceId;
  const def = getCharacterCard(char.cardId);

  return def.abilities
    .filter((ability) => ability.kind === 'active' && !ability.trigger && (!benched || ability.usableFromBench))
    .map((ability) => {
      const tags = abilityUsageTags(state, char, ability);
      // Une capacité est gratuite par défaut : celle qui ferme le tour (« Manipulation » de
      // Makima) doit le dire AVANT le clic, pas dans le journal après coup.
      if (ability.endsTurn === true) tags.push({ text: 'termine le tour', state: 'warn' });
      if (benched) tags.push({ text: 'depuis le banc', state: 'warn' });
      return {
        key: `${characterInstanceId}:${ability.id}`,
        label: ability.name,
        sub: benched ? def.name : undefined,
        disabledReason:
          denialOf(() => canUseAbility(state, characterInstanceId, ability)) ??
          conditionDenial(state, characterInstanceId, ability),
        description: ability.description,
        tags,
        hover: { title: ability.name, subtitle: `${def.name} · Active`, body: <p>{ability.description}</p> },
        run: () => conn.applyAction({ kind: 'use-ability', characterInstanceId, abilityId: ability.id }),
      };
    });
}

/**
 * Toutes les capacités activables du camp : celles de l'actif, plus celles des personnages
 * de réserve marquées `usableFromBench` (sans quoi des cartes comme « Boogie Woogie » de
 * Todo ou « Traque » de Chopper restent injouables tant qu'elles sont au banc).
 */
export function abilityOptions(state: GameState, you: PlayerId, conn: GameConnection): ActionOption[] {
  const player = state.players[you];
  const holders = [
    ...(player.activeCharacterInstanceId ? [player.activeCharacterInstanceId] : []),
    ...player.benchCharacterInstanceIds,
  ];
  return holders.flatMap((id) => abilityOptionsFor(state, you, conn, id));
}

export function switchOptions(state: GameState, you: PlayerId, conn: GameConnection): ActionOption[] {
  const player = state.players[you];
  const activeId = player.activeCharacterInstanceId;
  const denial = activeId ? denialOf(() => canSwitchStandard(state, activeId)) : 'aucun personnage actif';

  return player.benchCharacterInstanceIds.map((id) => {
    const char = player.characters[id]!;
    const hp = Math.max(0, char.currentMaxHP - char.damage);
    // Le refus global (`canSwitchStandard`) d'abord, puis celui qui dépend de la cible
    // (`canSwitchAny` : Arène ferme tout, le scellement de Chrollo ferme UNE carte).
    const targetDenial = denial ?? denialOf(() => canSwitchAny(state, you, activeId, id));
    return {
      key: id,
      label: characterName(char.cardId),
      detail: `${hp} PV`,
      detailNote: `sur ${char.currentMaxHP}`,
      disabledReason: targetDenial,
      run: () => conn.applyAction({ kind: 'switch', newActiveInstanceId: id }),
    };
  });
}

export function objectDenial(state: GameState, you: PlayerId): string | null {
  return denialOf(() => canPlayObject(state, you));
}

/**
 * Le refus propre à UNE carte objet ("aucun terrain adverse à annuler"...), en plus du refus
 * global d'`objectDenial`. Même fonction que celle dont le serveur se sert pour rejeter
 * l'action, donc la main dit exactement ce que dirait le message d'erreur.
 */
export function objectCardDenial(state: GameState, you: PlayerId, objectInstanceId: string): string | null {
  try {
    return describeObjectUnplayable(state, you, objectInstanceId);
  } catch {
    return null; // le serveur reste l'autorité
  }
}

export function terrainDenial(state: GameState, you: PlayerId): string | null {
  return denialOf(() => canPlayTerrain(state, you));
}

/**
 * Le refus du Recycleur d'Objets, calculé par la fonction du moteur elle-même : la zone du
 * recycleur se grise avec exactement la phrase que le serveur renverrait s'il refusait
 * l'action. `selectedIds` valide en plus une sélection précise ; sans lui, la question est
 * juste « ce joueur peut-il recycler quelque chose ? ».
 */
export function recycleDenial(state: GameState, you: PlayerId, selectedIds?: readonly string[]): string | null {
  try {
    return describeRecycleUnavailable(state, you, selectedIds);
  } catch {
    return null; // le serveur reste l'autorité
  }
}
