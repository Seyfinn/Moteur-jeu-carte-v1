import type { EffectContext } from './cards/types.js';
import type { EngineApi } from './engine-api.js';
import { isKO } from './hp.js';
import { findCharacter, getCriticalMultiplier, getEffectiveATK } from './queries.js';
import { getStatus, hasStatus, rollCritical, rollEvasion } from './statuses.js';
import { chancePercent } from './rng.js';
import { findCharacterOwner } from './zones.js';
import { otherPlayer, type EngineEvent, type GameState, type PlayerId } from './types.js';

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
  function consumeMissedConcentration(char: ReturnType<typeof findCharacter>): void {
    api.removeStatus(char.instanceId, 'concentration');
    api.applyStatus(char.instanceId, { statusId: 'disarmed', label: 'Concentration ratée', remainingTurns: 2 });
    api.log(`${char.cardId} rate sa Concentration : aucun dégât, ne pourra pas attaquer au prochain tour`, {
      characterInstanceId: char.instanceId,
    });
  }

  function getActive(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.activeCharacterInstanceId ? p.characters[p.activeCharacterInstanceId] : undefined;
  }
  function getBench(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.benchCharacterInstanceIds.map((id) => p.characters[id]!);
  }

  return {
    state,
    ownerId,
    opponentId,
    sourceInstanceId,
    event,

    log(message, data) {
      api.log(message, data);
    },
    flipCoin() {
      const result = api.flipCoin();
      api.log(`Coin flip: ${result}`, { sourceInstanceId, result });
      return result;
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
      await api.koCharacter(characterInstanceId);
    },
    async reviveCharacter(characterInstanceId, hp, placement) {
      await api.reviveCharacter(characterInstanceId, hp, placement);
    },

    async dealDamage(targetInstanceId, amount, options) {
      const selfInflicted = targetInstanceId === sourceInstanceId;
      const source = isAttackOrAbility && !selfInflicted ? state.players[ownerId].characters[sourceInstanceId] : undefined;
      // "Concentration" only arms on a literal attack (not an ability's damage) -- see damageSource above.
      const concentration = damageSource === 'attack' && source ? getStatus(source, 'concentration') : undefined;

      // Critique/esquive (innate or status-driven) only apply to attacks and
      // abilities, never to object-card effects, self-inflicted damage, or
      // poison/burn ticks (those call api.dealDamage directly, bypassing this
      // context entirely).
      if (!options?.skipEvasionRoll && isAttackOrAbility && !selfInflicted) {
        const target = findCharacter(state, targetInstanceId);
        if (rollEvasion(state, target)) {
          api.log(`${target.cardId} esquive l'attaque`, { targetInstanceId, sourceInstanceId });
          if (concentration) consumeMissedConcentration(source!);
          return;
        }
      }

      // "Hypnose Absolue" (Aizen) : sur une attaque/ability adverse qui le touche, 40% de
      // chance que les dégâts soient entièrement redirigés vers un allié du banc choisi
      // par le joueur d'Aizen. Vérifié via cardId plutôt qu'un statut posé en lazy-init :
      // Aizen doit être protégé dès le tout premier coup subi, avant même d'avoir pu agir
      // une seule fois -- onGameStart/onBecomeActive ne se déclenchent pas à la mise en
      // place initiale (voir CLAUDE.md), donc aucun trigger fiable n'existe pour poser un
      // statut à temps.
      let resolvedTargetId = targetInstanceId;
      if (isAttackOrAbility && !selfInflicted) {
        const hypnoseTarget = findCharacter(state, resolvedTargetId);
        if (hypnoseTarget.cardId === 'aizen' && chancePercent(state.rng, 40)) {
          const targetOwnerId = findCharacterOwner(state, resolvedTargetId);
          const aliveBench = state.players[targetOwnerId].benchCharacterInstanceIds.filter(
            (id) => id !== resolvedTargetId && !isKO(state.players[targetOwnerId].characters[id]!)
          );
          if (aliveBench.length > 0) {
            const answer = await api.chooseFor(targetOwnerId, {
              kind: 'select-characters',
              prompt: "Hypnose Absolue : choisissez le personnage du banc qui subit les dégâts à la place d'Aizen",
              options: aliveBench,
              min: 1,
              max: 1,
            });
            if (answer.kind !== 'select-characters') throw new Error('Unexpected choice answer kind');
            const chosen = answer.selected[0];
            if (chosen) {
              api.log(`Hypnose Absolue redirects the attack to ${chosen}`, { from: resolvedTargetId, to: chosen });
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
          api.log(`${source!.cardId} se concentre et critique (x${multiplier}) !`, { sourceInstanceId, targetInstanceId: resolvedTargetId, baseAmount: amount, amount: finalAmount });
        } else {
          consumeMissedConcentration(source!);
          finalAmount = 0;
        }
      } else if (source && rollCritical(state, source)) {
        const multiplier = getCriticalMultiplier(state, sourceInstanceId);
        finalAmount = amount * multiplier;
        api.log(`${source.cardId} inflige un coup critique (x${multiplier}) !`, { sourceInstanceId, targetInstanceId: resolvedTargetId, baseAmount: amount, amount: finalAmount });
      }

      // "Couteau dans le dos" : double les dégâts de n'importe lequel de vos personnages
      // contre le banc ennemi (statut posé sur chaque personnage à la pose de l'objet).
      if (source && hasStatus(source, 'couteau-dans-le-dos')) {
        const targetOwner = findCharacterOwner(state, resolvedTargetId);
        if (targetOwner !== ownerId && state.players[targetOwner].benchCharacterInstanceIds.includes(resolvedTargetId)) {
          finalAmount *= 2;
          api.log(`${source.cardId} frappe dans le dos : dégâts au banc doublés`, { sourceInstanceId, targetInstanceId: resolvedTargetId, amount: finalAmount });
        }
      }

      // "Miroir de Renvoi" : le porteur renvoie un pourcentage des dégâts subis à
      // l'attaquant (une fois), puis l'objet qui portait l'effet se détruit. Statut
      // générique reconnu par le moteur ici, comme "couteau-dans-le-dos" -- l'identité
      // de l'attaquant (via `source`) n'est disponible qu'à ce point précis du pipeline,
      // afterDamage ne la porte pas dans son payload (même limite documentée pour
      // onCharacterKO dans CLAUDE.md).
      if (source && finalAmount > 0) {
        const target = findCharacter(state, resolvedTargetId);
        const mirror = getStatus(target, 'miroir-de-renvoi');
        if (mirror) {
          api.removeStatus(target.instanceId, 'miroir-de-renvoi');
          const objectInstanceId = mirror.data?.['objectInstanceId'] as string | undefined;
          if (objectInstanceId) api.destroyObject(objectInstanceId);
          const percent = Number(mirror.data?.['percent'] ?? 50);
          const reflected = Math.round(finalAmount * (percent / 100));
          if (reflected > 0) {
            api.log(`${target.cardId} renvoie ${reflected} dégâts via Miroir de Renvoi`, {
              targetInstanceId: source.instanceId,
              amount: reflected,
            });
            await api.dealDamage(source.instanceId, reflected);
          }
        }
      }

      // "Coeur Acier" (terrain) : si le personnage qui vient d'être touché est la cible
      // chargée du terrain "Coeur Acier" du camp de l'attaquant, celui-ci gagne du HP max
      // (sans soin), puis la marque se réinitialise. Comme "Miroir de Renvoi"/"Couteau
      // dans le dos", géré directement ici (pas via un trigger) car l'identité de
      // l'attaquant n'est disponible qu'à ce point précis du pipeline. "Attaquer" au sens
      // strict de la carte : seule une Attack literal arme l'effet, jamais une ability.
      if (damageSource === 'attack' && source && finalAmount > 0) {
        const terrainId = state.players[ownerId].activeTerrainInstanceId;
        const terrain = terrainId ? state.players[ownerId].terrains[terrainId] : undefined;
        if (
          terrain &&
          terrain.cardId === 'coeur-acier' &&
          terrain.data?.['charged'] &&
          terrain.data?.['markedInstanceId'] === resolvedTargetId
        ) {
          const bonus = Number(terrain.data?.['bonusMaxHP'] ?? 150);
          api.raiseMaxHP(source.instanceId, bonus);
          terrain.data = { ...terrain.data, charged: false };
          api.log(`Coeur Acier : ${source.cardId} gagne ${bonus} HP max`, {
            sourceInstanceId: source.instanceId,
            targetInstanceId: resolvedTargetId,
          });
        }
      }

      if (options?.asValeurLock) {
        await api.applyValeurLock(resolvedTargetId, finalAmount);
        return;
      }
      await api.dealDamage(resolvedTargetId, finalAmount, options);
    },
    async applyValeurLock(targetInstanceId, amount) {
      await api.applyValeurLock(targetInstanceId, amount);
    },
    heal(targetInstanceId, amount) {
      api.heal(targetInstanceId, amount);
    },
    raiseMaxHP(targetInstanceId, amount) {
      api.raiseMaxHP(targetInstanceId, amount);
    },
    addShield(targetInstanceId, amount) {
      api.addShield(targetInstanceId, amount);
    },
    removeShield(targetInstanceId, amount) {
      api.removeShield(targetInstanceId, amount);
    },

    applyStatus(targetInstanceId, status, options) {
      // Same esquive scoping as dealDamage: attacks/abilities only, never self-applied.
      if (!options?.skipEvasionRoll && isAttackOrAbility && targetInstanceId !== sourceInstanceId) {
        const target = findCharacter(state, targetInstanceId);
        if (rollEvasion(state, target)) {
          api.log(`${target.cardId} esquive l'altération ${status.statusId}`, { targetInstanceId, statusId: status.statusId, sourceInstanceId });
          return;
        }
      }
      api.applyStatus(targetInstanceId, status);
    },
    rollEvasion(targetInstanceId) {
      if (!isAttackOrAbility || targetInstanceId === sourceInstanceId) return false;
      const target = findCharacter(state, targetInstanceId);
      const evaded = rollEvasion(state, target);
      if (evaded) {
        api.log(`${target.cardId} esquive`, { targetInstanceId, sourceInstanceId });
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
