import type { ReactNode } from 'react';
import {
  canAttack,
  canPlayObject,
  canPlayTerrain,
  canSwitchStandard,
  canUseAbility,
  describeDenials,
  describeObjectUnplayable,
  getCharacterCard,
  getEffectiveATK,
  getObjectCard,
  getTerrainCard,
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

export function characterName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

/** Une entrée du panneau de commandes (une attaque, une capacité, une cible de switch). */
export interface ActionOption {
  key: string;
  label: string;
  /** Chiffre-clé affiché à droite du libellé (ATK effectif, PV de la cible...). */
  detail?: string;
  /** Sous-titre discret sous le libellé (le personnage qui porte la capacité). */
  sub?: string;
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

export function attackOptions(state: GameState, you: PlayerId, conn: GameConnection): ActionOption[] {
  const player = state.players[you];
  const activeId = player.activeCharacterInstanceId;
  if (!activeId) return [];
  const char = player.characters[activeId];
  if (!char) return [];
  const def = getCharacterCard(char.cardId);
  const denial = denialOf(() => canAttack(state, activeId));

  return def.attacks.map((attack) => {
    // ATK effectif, pas la valeur imprimée : buffs, debuffs et passives cumulatives
    // atterrissent ici, et le joueur n'avait aucun moyen de voir le nombre qu'il allait
    // réellement infliger.
    let effective = attack.baseATK;
    try {
      effective = getEffectiveATK(state, activeId, attack.baseATK);
    } catch {
      /* la vue client n'arrive pas à le résoudre -- on retombe sur la valeur imprimée */
    }
    const suffix = effective === attack.baseATK ? '' : ` (base ${attack.baseATK})`;
    return {
      key: attack.id,
      label: attack.name,
      detail: `${effective} ATK`,
      disabledReason: denial,
      hover: { title: attack.name, subtitle: `${effective} ATK${suffix}`, body: <p>{attack.description}</p> },
      run: () => conn.applyAction({ kind: 'attack', characterInstanceId: activeId, attackId: attack.id }),
    };
  });
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
    .map((ability) => ({
      key: `${characterInstanceId}:${ability.id}`,
      label: ability.name,
      sub: benched ? def.name : undefined,
      disabledReason: denialOf(() => canUseAbility(state, characterInstanceId, ability)),
      hover: { title: ability.name, subtitle: `${def.name} · Active`, body: <p>{ability.description}</p> },
      run: () => conn.applyAction({ kind: 'use-ability', characterInstanceId, abilityId: ability.id }),
    }));
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
    return {
      key: id,
      label: characterName(char.cardId),
      detail: `${hp} PV`,
      disabledReason: denial,
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
