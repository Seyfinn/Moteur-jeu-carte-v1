import type { EffectContext } from './cards/types.js';
import type { EngineApi } from './engine-api.js';
import { isKO } from './hp.js';
import {
  evaluateTransform,
  findCharacter,
  getCriticalMultiplier,
  getCriticalPercent,
  getEffectiveATK,
  getEvasionPercent,
  rollCritical,
  rollEvasion,
} from './queries.js';
import { BASE_CRITICAL_CHANCE_PERCENT, BASE_EVASION_CHANCE_PERCENT } from './statuses.js';
import { getStatus } from './statuses.js';
import { chancePercent } from './rng.js';
import { findCharacterOwner } from './zones.js';
import { cardName } from './names.js';
import { otherPlayer, type EngineEvent, type GameState, type PlayerId } from './types.js';

/**
 * Tire un jet à pourcentage porté par une carte **et** l'annonce : le client transforme
 * chaque entrée `kind: 'chance-roll'` en roue de pourcentage à l'écran, pour les deux
 * joueurs, que le jet passe ou non. Tout tirage visible par le joueur devrait passer par
 * là plutôt que par un `chancePercent` muet (voir `ctx.rollChance`).
 */
function announceChanceRoll(
  state: GameState,
  api: EngineApi,
  percent: number,
  label: string,
  characterInstanceId: string,
  sourceInstanceId: string
): boolean {
  const hit = chancePercent(state.rng, percent);
  const char = state.players.p1.characters[characterInstanceId] ?? state.players.p2.characters[characterInstanceId];
  const who = char ? `${cardName(char.cardId)} : ` : '';
  api.log(`${who}${label} (${Math.round(percent)} %) -- ${hit ? 'réussi' : 'raté'}`, {
    kind: 'chance-roll',
    label,
    percent,
    hit,
    characterInstanceId,
    sourceInstanceId,
  });
  return hit;
}

export function buildEffectContext(
  state: GameState,
  sourceInstanceId: string,
  ownerId: PlayerId,
  api: EngineApi,
  event?: EngineEvent,
  damageSource: 'attack' | 'ability' | 'other' = 'ability'
): EffectContext {
  const opponentId = otherPlayer(ownerId);
  const isAttackOrAbility = damageSource !== 'other';

  /** "Concentration" ratée : consomme le statut, inflige 0 et empêche d'attaquer au tour suivant. */
  /**
   * Un jet à pourcentage n'est « annoncé » que si son taux ne vient pas du personnage
   * lui-même mais d'une carte : statut `evasive`/`critical`, ou modifier déclaré par une
   * capacité ou un objet. Au taux de base (5 % d'esquive, 2 % de critique), rien n'est
   * annoncé -- le client en fait une mini-roue à l'écran, et elle tournerait sinon à
   * chaque coup de la partie.
   *
   * La réussite enrichit l'entrée de journal qui existe déjà ; seul l'échec en ajoute
   * une, pour que le joueur ne se retrouve pas avec deux lignes pour un seul jet.
   */
  function rollEvasionAnnounced(targetInstanceId: string): { evaded: boolean; percent: number; fromCard: boolean } {
    const target = findCharacter(state, targetInstanceId);
    const percent = getEvasionPercent(state, target);
    const fromCard = percent !== BASE_EVASION_CHANCE_PERCENT;
    const evaded = rollEvasion(state, target);
    if (!evaded && fromCard) {
      api.log(`${cardName(target.cardId)} rate son esquive (${Math.round(percent)} %)`, {
        kind: 'proc-miss',
        roll: 'evasion',
        characterInstanceId: targetInstanceId,
        percent,
      });
    }
    return { evaded, percent, fromCard };
  }

  function rollCriticalAnnounced(source: ReturnType<typeof findCharacter>): { crit: boolean; percent: number; fromCard: boolean } {
    const percent = getCriticalPercent(state, source);
    const fromCard = percent !== BASE_CRITICAL_CHANCE_PERCENT;
    const crit = rollCritical(state, source);
    if (!crit && fromCard) {
      api.log(`${cardName(source.cardId)} rate son critique (${Math.round(percent)} %)`, {
        kind: 'proc-miss',
        roll: 'critical',
        characterInstanceId: source.instanceId,
        percent,
      });
    }
    return { crit, percent, fromCard };
  }

  function consumeMissedConcentration(char: ReturnType<typeof findCharacter>): void {
    api.removeStatus(char.instanceId, 'concentration');
    api.applyStatus(char.instanceId, { statusId: 'disarmed', label: 'Concentration ratée', remainingTurns: 2 });
    api.log(`${cardName(char.cardId)} rate sa Concentration : aucun dégât, et ne pourra pas attaquer au prochain tour`, {
      kind: 'concentration-missed',
      characterInstanceId: char.instanceId,
    });
  }

  function getActive(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.activeCharacterInstanceId ? p.characters[p.activeCharacterInstanceId] : undefined;
  }
  function getBench(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.benchCharacterInstanceIds
      .map((id) => p.characters[id])
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
  }

  /**
   * Esquive/critique only ever come into play between opposing sides. An effect
   * touching one of its own owner's characters -- a friendly heal-by-damage, a terrain
   * locking down its own active, a self-buff -- must never be "dodged" by the very
   * player who cast it.
   */
  function canRollAgainst(targetInstanceId: string): boolean {
    if (!isAttackOrAbility || targetInstanceId === sourceInstanceId) return false;
    return findCharacterOwner(state, targetInstanceId) !== ownerId;
  }

  return {
    state,
    ownerId,
    opponentId,
    sourceInstanceId,
    event,
    // Fresh per built context. match.ts hands the *same* context object to an attack's
    // execute() and to its endsTurn(), so this is the safe place for an attack to stash
    // "what happened while I resolved" -- unlike a module-level variable, which would be
    // shared by every match running in the same server process.
    scratch: {},

    log(message, data) {
      api.log(message, data);
    },
    flipCoin() {
      const result = api.flipCoin();
      api.log(`Pile ou face : ${result === 'heads' ? 'pile' : 'face'}`, { kind: 'coin-flip', sourceInstanceId, result });
      return result;
    },

    rollChance(percent, label, options) {
      // La roue à l'écran nomme un personnage : la cible du jet quand la carte la précise,
      // la source de l'effet sinon.
      const characterInstanceId = options?.characterInstanceId ?? sourceInstanceId;
      return announceChanceRoll(state, api, percent, label, characterInstanceId, sourceInstanceId);
    },

    async choose(spec) {
      const answer = await api.chooseFor(ownerId, spec);
      if (answer.kind !== 'select-characters') throw new Error('Unexpected choice answer kind');
      return answer.selected;
    },
    async chooseOption(prompt, options) {
      const answer = await api.chooseFor(ownerId, { kind: 'select-option', prompt, options });
      if (answer.kind !== 'select-option') throw new Error('Unexpected choice answer kind');
      return answer.key;
    },
    async chooseYesNo(prompt) {
      const answer = await api.chooseFor(ownerId, { kind: 'yes-no', prompt });
      if (answer.kind !== 'yes-no') throw new Error('Unexpected choice answer kind');
      return answer.value;
    },
    async chooseOrder(prompt, items) {
      const answer = await api.chooseFor(ownerId, { kind: 'order', prompt, items });
      if (answer.kind !== 'order') throw new Error('Unexpected choice answer kind');
      return answer.orderedKeys;
    },

    getCharacter(instanceId) {
      return findCharacter(state, instanceId);
    },
    getObject(instanceId) {
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const obj = state.players[pid].objects[instanceId];
        if (obj) return obj;
      }
      throw new Error(`Unknown object instance "${instanceId}"`);
    },
    getTerrain(instanceId) {
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const terrain = state.players[pid].terrains[instanceId];
        if (terrain) return terrain;
      }
      throw new Error(`Unknown terrain instance "${instanceId}"`);
    },
    getActive,
    getBench,
    getAllOnBoard(playerId) {
      const active = getActive(playerId);
      const bench = getBench(playerId);
      return active ? [active, ...bench] : bench;
    },
    isKO(characterInstanceId) {
      return isKO(findCharacter(state, characterInstanceId));
    },
    async koCharacter(characterInstanceId) {
      // Credit the kill to the effect's own character source when there is one, so
      // onCharacterKO listeners can tell who did it (an object/terrain source has no
      // character to attribute it to and stays anonymous).
      const killer = state.players[ownerId].characters[sourceInstanceId]?.instanceId;
      await api.koCharacter(characterInstanceId, killer);
    },
    async reviveCharacter(characterInstanceId, hp, placement) {
      await api.reviveCharacter(characterInstanceId, hp, placement);
    },

    async dealDamage(targetInstanceId, amount, options) {
      if (!api.isOnBoard(targetInstanceId)) return;
      const selfInflicted = targetInstanceId === sourceInstanceId;
      const source = isAttackOrAbility && !selfInflicted ? state.players[ownerId].characters[sourceInstanceId] : undefined;
      // "Concentration" only arms on a literal attack (not an ability's damage) -- see damageSource above.
      const concentration = damageSource === 'attack' && source ? getStatus(source, 'concentration') : undefined;

      // Critique/esquive (innate or status-driven) only apply to attacks and
      // abilities aimed at the OTHER side, never to object-card effects, friendly
      // fire / self-inflicted damage, or poison/burn ticks (those call
      // api.dealDamage directly, bypassing this context entirely).
      if (!options?.skipEvasionRoll && canRollAgainst(targetInstanceId)) {
        const target = findCharacter(state, targetInstanceId);
        const { evaded, percent, fromCard } = rollEvasionAnnounced(targetInstanceId);
        if (evaded) {
          api.log(`${cardName(target.cardId)} esquive l'attaque`, { kind: 'evasion', targetInstanceId, sourceInstanceId, percent, fromCard });
          if (concentration) consumeMissedConcentration(source!);
          return;
        }
      }

      // Redirection (e.g. Aizen's "Hypnose Absolue"): any card in play can declare a
      // `getDamageRedirectPercent` modifier for one of its characters; on a successful
      // roll, that character's owner picks which of their benched allies eats the hit
      // instead. Driven entirely by the card's own modifier -- the engine knows nothing
      // about which card it is.
      let resolvedTargetId = targetInstanceId;
      if (isAttackOrAbility && !selfInflicted) {
        const redirectPercent = Number(
          evaluateTransform(state, 'getDamageRedirectPercent', { targetInstanceId, sourceInstanceId }, 0)
        );
        // Annoncé comme n'importe quel jet porté par une carte (kind 'chance-roll') : le
        // client en fait tourner une roue, réussite comme échec.
        const redirected =
          redirectPercent > 0 &&
          announceChanceRoll(state, api, redirectPercent, 'Redirection', targetInstanceId, sourceInstanceId);
        if (redirected) {
          const targetOwnerId = findCharacterOwner(state, targetInstanceId);
          const aliveBench = state.players[targetOwnerId].benchCharacterInstanceIds.filter(
            (id) => id !== targetInstanceId && !isKO(state.players[targetOwnerId].characters[id]!)
          );
          if (aliveBench.length > 0) {
            const answer = await api.chooseFor(targetOwnerId, {
              kind: 'select-characters',
              prompt: 'Redirection : choisissez le personnage du banc qui subit les dégâts à la place',
              options: aliveBench,
              min: 1,
              max: 1,
            });
            const chosen = answer.kind === 'select-characters' ? answer.selected[0] : undefined;
            if (chosen && api.isOnBoard(chosen)) {
              api.log(`Les dégâts sont redirigés vers ${cardName(findCharacter(state, chosen).cardId)}`, {
                kind: 'redirect',
                from: targetInstanceId,
                to: chosen,
              });
              resolvedTargetId = chosen;
            }
          }
        }
      }

      let finalAmount = amount;
      if (concentration) {
        const percent = Number(concentration.data?.['percent'] ?? 70);
        if (chancePercent(state.rng, percent)) {
          api.removeStatus(source!.instanceId, 'concentration');
          const multiplier = getCriticalMultiplier(state, sourceInstanceId);
          finalAmount = amount * multiplier;
          // La Concentration est un objet : son taux vient toujours d'une carte.
          api.log(`${cardName(source!.cardId)} se concentre et fait un critique (x${multiplier}) !`, { kind: 'critical', sourceInstanceId, targetInstanceId: resolvedTargetId, baseAmount: amount, amount: finalAmount, percent, fromCard: true });
        } else {
          consumeMissedConcentration(source!);
          finalAmount = 0;
        }
      } else if (source) {
        const { crit, percent, fromCard } = rollCriticalAnnounced(source);
        if (crit) {
          const multiplier = getCriticalMultiplier(state, sourceInstanceId);
          finalAmount = amount * multiplier;
          api.log(`${cardName(source.cardId)} inflige un coup critique (x${multiplier}) !`, { kind: 'critical', sourceInstanceId, targetInstanceId: resolvedTargetId, baseAmount: amount, amount: finalAmount, percent, fromCard });
        }
      }

      // 'bench-damage-bonus' (e.g. "Couteau dans le dos"): the bearer's damage against
      // the ENEMY bench is multiplied. Generic engine-recognised status, like
      // death-ward/atk-boost -- the attacker's identity only exists at this exact point
      // of the pipeline, so it can't live in a per-card trigger.
      if (source && finalAmount > 0) {
        const benchBonus = getStatus(source, 'bench-damage-bonus');
        if (benchBonus) {
          const targetOwner = findCharacterOwner(state, resolvedTargetId);
          if (targetOwner !== ownerId && state.players[targetOwner].benchCharacterInstanceIds.includes(resolvedTargetId)) {
            const multiplier = Number(benchBonus.data?.['multiplier'] ?? 2);
            finalAmount = Math.round(finalAmount * multiplier);
            api.log(`${cardName(source.cardId)} frappe dans le dos : dégâts au banc x${multiplier}`, { kind: 'info', sourceInstanceId, targetInstanceId: resolvedTargetId, amount: finalAmount });
          }
        }
      }

      // 'damage-reflect' (e.g. "Miroir de Renvoi"): the bearer bounces a percentage of
      // this hit straight back at the attacker, once, then the status (and the object
      // carrying it, if any) is consumed.
      if (source && finalAmount > 0) {
        const target = findCharacter(state, resolvedTargetId);
        const mirror = getStatus(target, 'damage-reflect');
        if (mirror) {
          api.removeStatus(target.instanceId, 'damage-reflect');
          const objectInstanceId = mirror.data?.['objectInstanceId'] as string | undefined;
          if (objectInstanceId) api.destroyObject(objectInstanceId);
          const percent = Number(mirror.data?.['percent'] ?? 50);
          const reflected = Math.round(finalAmount * (percent / 100));
          if (reflected > 0) {
            api.log(`${cardName(target.cardId)} renvoie ${reflected} dégâts à ${cardName(source.cardId)}`, {
              kind: 'info',
              targetInstanceId: source.instanceId,
              amount: reflected,
            });
            await api.dealDamage(source.instanceId, reflected);
          }
        }
      }

      // 'hit-bounty' (e.g. the "Coeur Acier" terrain's charged mark): the first attack
      // that really lands on the bearer pays its attacker in permanent max HP, then the
      // mark is consumed. `data.forOwnerId` restricts who can collect it.
      if (damageSource === 'attack' && source && finalAmount > 0) {
        const target = findCharacter(state, resolvedTargetId);
        const bounty = getStatus(target, 'hit-bounty');
        const forOwnerId = bounty?.data?.['forOwnerId'] as PlayerId | undefined;
        if (bounty && (forOwnerId === undefined || forOwnerId === ownerId)) {
          api.removeStatus(target.instanceId, 'hit-bounty');
          const bonus = Number(bounty.data?.['bonusMaxHP'] ?? 0);
          if (bonus > 0) {
            // Une prime, pas un soin : le plafond monte, les PV actuels ne bougent pas.
            api.raiseMaxHP(source.instanceId, bonus, { keepCurrentHP: true });
            api.log(`${cardName(source.cardId)} encaisse la prime : +${bonus} HP max`, {
              kind: 'info',
              sourceInstanceId: source.instanceId,
              targetInstanceId: resolvedTargetId,
            });
          }
        }
      }

      // `source` is deliberately undefined for self-inflicted damage (no crit on
      // yourself), so ownership is taken from the effect's owner instead -- a card must
      // still be able to recognise "this damage comes from my own side".
      const withAttribution = { ...options, attackerInstanceId: source?.instanceId, attackerOwnerId: ownerId };
      if (options?.asValeurLock) {
        await api.applyValeurLock(resolvedTargetId, finalAmount, withAttribution);
        return;
      }
      await api.dealDamage(resolvedTargetId, finalAmount, withAttribution);
    },
    async applyValeurLock(targetInstanceId, amount) {
      await api.applyValeurLock(targetInstanceId, amount, { attackerOwnerId: ownerId });
    },
    heal(targetInstanceId, amount) {
      api.heal(targetInstanceId, amount);
    },
    raiseMaxHP(targetInstanceId, amount, options) {
      api.raiseMaxHP(targetInstanceId, amount, options);
    },
    addShield(targetInstanceId, amount) {
      api.addShield(targetInstanceId, amount);
    },
    removeShield(targetInstanceId, amount) {
      api.removeShield(targetInstanceId, amount);
    },

    applyStatus(targetInstanceId, status, options) {
      // Same esquive scoping as dealDamage: hostile attacks/abilities only.
      if (!options?.skipEvasionRoll && canRollAgainst(targetInstanceId)) {
        const target = findCharacter(state, targetInstanceId);
        const { evaded, percent, fromCard } = rollEvasionAnnounced(targetInstanceId);
        if (evaded) {
          api.log(`${cardName(target.cardId)} esquive l'altération « ${status.label || status.statusId} »`, { kind: 'evasion', targetInstanceId, statusId: status.statusId, sourceInstanceId, percent, fromCard });
          return;
        }
      }
      api.applyStatus(targetInstanceId, status);
    },
    rollEvasion(targetInstanceId) {
      if (!canRollAgainst(targetInstanceId)) return false;
      const target = findCharacter(state, targetInstanceId);
      const { evaded, percent, fromCard } = rollEvasionAnnounced(targetInstanceId);
      if (evaded) {
        api.log(`${cardName(target.cardId)} esquive`, { kind: 'evasion', targetInstanceId, sourceInstanceId, percent, fromCard });
      }
      return evaded;
    },
    removeStatus(targetInstanceId, statusId) {
      api.removeStatus(targetInstanceId, statusId);
    },

    getEffectiveATK(characterInstanceId, baseATK) {
      return getEffectiveATK(state, characterInstanceId, baseATK);
    },

    swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId) {
      api.swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId);
    },

    attachSelfTo(targetCharacterInstanceId) {
      api.attachObject(sourceInstanceId, targetCharacterInstanceId);
    },

    destroyObject(objectInstanceId) {
      api.destroyObject(objectInstanceId);
    },

    extendTerrain(terrainInstanceId, turns) {
      api.extendTerrain(terrainInstanceId, turns);
    },
    async shortenTerrain(terrainInstanceId, turns) {
      await api.shortenTerrain(terrainInstanceId, turns);
    },
    async destroyTerrain(terrainInstanceId) {
      await api.destroyTerrain(terrainInstanceId);
    },

    async forceSwitch(playerId, newActiveInstanceId) {
      await api.switchActive(playerId, newActiveInstanceId);
    },

    cloneCharacter(sourceCharInstanceId, hp, placement) {
      const cloneOwner = findCharacter(state, sourceCharInstanceId).ownerId;
      return api.cloneCharacter(cloneOwner, sourceCharInstanceId, hp, placement);
    },
    createObject(cardId) {
      return api.createObject(ownerId, cardId);
    },
  };
}
