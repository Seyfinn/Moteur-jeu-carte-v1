import type { AbilityDef, AttackDef, EffectContext } from './cards/types.js';
import type { EngineApi } from './engine-api.js';
import type { GameState } from './types.js';
import { buildEffectContext } from './effect-context.js';
import { findCharacter } from './queries.js';

/**
 * Évaluation « à blanc » d'un `condition()` d'attaque ou de capacité, pour que le client
 * puisse griser une action que le serveur refuserait, au lieu de la proposer et de la faire
 * rebondir en message d'erreur rouge.
 *
 * Le besoin vient d'Escanor : ses quatre attaques sont gardées par `condition` (une seule
 * est ouverte selon le cycle en cours), et rien dans `canAttack` ne le dit -- le panneau de
 * commandes les offrait donc toutes les quatre. Même chose pour une bonne vingtaine de
 * capacités (le Hook de Blitzcrank sans banc à tirer, le Sacrifice de Makima sans allié à
 * sacrifier, le Soin Sacrificiel de Soraka trop bas en PV...).
 *
 * C'est le pendant de `describeObjectUnplayable` pour les objets, à une différence près :
 * `unplayableReason` est un pur `GameState` donc trivialement rejouable côté client, alors
 * qu'un `condition` demande un `EffectContext`. D'où le contexte en lecture seule ci-dessous.
 */

/**
 * Un `EngineApi` dont **toute** opération lève. Par contrat, un `condition` est un prédicat
 * pur : il lit le plateau et rend un booléen. Un jour où une carte tricherait et essaierait
 * de muter quoi que ce soit depuis son `condition`, l'appel casse ici au lieu de corrompre
 * la copie locale de l'état -- et l'appelant retombe alors sur « autorisé », le serveur
 * restant de toute façon la seule autorité.
 */
function readOnlyApi(): EngineApi {
  const refuse = (member: string) => (): never => {
    throw new Error(`Contexte en lecture seule : ${member} est interdit dans un condition()`);
  };
  return new Proxy({} as EngineApi, {
    get(_target, property) {
      // `rng` est une donnée, pas un appel : la lire ne change rien tant que personne ne
      // tire dessus (ce que seuls les membres refusés ci-dessus savent faire).
      if (property === 'rng') return { seed: 0 };
      return refuse(String(property));
    },
  });
}

/** Contexte de lecture seule pour `characterInstanceId`, vu depuis son propre camp. */
function previewContext(state: GameState, characterInstanceId: string): EffectContext {
  const char = findCharacter(state, characterInstanceId);
  return buildEffectContext(state, characterInstanceId, char.ownerId, readOnlyApi());
}

/**
 * Le `condition()` de cette attaque/capacité tient-il maintenant ?
 *
 * Vrai quand il n'y a pas de condition, quand elle tient, **et** quand elle n'a pas pu être
 * évaluée : sur la vue caviardée d'un joueur, une carte peut manquer d'information et le
 * serveur, lui, tranchera. Mieux vaut proposer une action qui rebondit que d'en interdire
 * une parfaitement légale.
 */
export function memberConditionHolds(
  state: GameState,
  characterInstanceId: string,
  member: Pick<AttackDef | AbilityDef, 'condition'>
): boolean {
  if (!member.condition) return true;
  try {
    return member.condition(previewContext(state, characterInstanceId));
  } catch {
    return true;
  }
}
