import type { BuiltinStatusId, CharacterInstance, GameState, PlayerId, StatusInstance } from './types.js';
import type { EngineApi } from './engine-api.js';
import { cardName } from './names.js';

/** Fixed damage-per-tick formulas -- not customizable via a status's `data`.
 * Exported so the in-game glossary (web/components/EffectsGlossary) states the rules the
 * engine actually applies instead of a hand-copied duplicate that can drift. */
export const BURN_DAMAGE = 50;
export const POISON_FLAT_DAMAGE = 10;
export const POISON_PERCENT_OF_MAX_HP = 0.1;
export const BLEED_PERCENT_PER_STACK = 0.1;
export const BLEED_MAX_STACKS = 10;
/** 'vulnerable': every damage instance the bearer takes is raised by this percentage. */
export const VULNERABLE_DAMAGE_BONUS_PERCENT = 50;

/**
 * Every status id the engine itself gives meaning to. A card is free to invent any other
 * string for its own bookkeeping, but those belong to that card alone -- which is what
 * lets a "swap/steal all statuses" effect know what it may legitimately move around
 * (moving a card's private counter onto a card that cannot read it just deletes it).
 */
export const BUILTIN_STATUS_IDS: ReadonlySet<string> = new Set<BuiltinStatusId>([
  'stun',
  'disarmed',
  'silence-active',
  'silence-passive',
  'silence-ultimate',
  'atk-reduction',
  'atk-boost',
  'atk-multiplier',
  'burn',
  'poison',
  'bleed',
  'evasive',
  'critical',
  'chained',
  'death-ward',
  'concentration',
  'damage-reflect',
  'bench-damage-bonus',
  'hit-bounty',
  'vulnerable',
  'linked',
  'extra-attack',
  'crit-streak',
  'forced-attack',
]);

/** Human labels for the three damage-over-time statuses, used in the event log. */
const STATUS_TICK_LABELS: Record<string, string> = {
  burn: 'brûlure',
  poison: 'poison',
  bleed: 'saignement',
};

/** Innate rates every character has on their attacks/abilities, with no status required. */
export const BASE_EVASION_CHANCE_PERCENT = 5;
export const BASE_CRITICAL_CHANCE_PERCENT = 2;
/** Rates while the 'evasive'/'critical' status is present -- replaces the base rate, doesn't stack with it. */
export const EVASIVE_STATUS_CHANCE_PERCENT = 33;
export const CRITICAL_STATUS_CHANCE_PERCENT = 33;

export function hasStatus(char: CharacterInstance, statusId: string): boolean {
  return char.statuses.some((s) => s.statusId === statusId);
}

export function getStatus(char: CharacterInstance, statusId: string): StatusInstance | undefined {
  return char.statuses.find((s) => s.statusId === statusId);
}

export function isStunned(char: CharacterInstance): boolean {
  return hasStatus(char, 'stun');
}

export function isDisarmed(char: CharacterInstance): boolean {
  return hasStatus(char, 'disarmed');
}

export function isEvasive(char: CharacterInstance): boolean {
  return hasStatus(char, 'evasive');
}

export function isCritical(char: CharacterInstance): boolean {
  return hasStatus(char, 'critical');
}

export function isVulnerable(char: CharacterInstance): boolean {
  return hasStatus(char, 'vulnerable');
}

/**
 * Vulnerable: a flat damage amplification on the RECEIVING side (+50%), applied in
 * match.ts's dealDamage before any card's `getIncomingDamageAmount` reduction, so a
 * reduction still applies to the real incoming number. Damage a character inflicts on
 * itself as a cost (`ignoreDamageReduction`) is deliberately left alone -- amplifying a
 * self-paid HP cost would punish the bearer twice for the same debuff.
 * Returns 1 (no-op) when the status is absent.
 */
export function getVulnerableDamageMultiplier(char: CharacterInstance): number {
  return isVulnerable(char) ? 1 + VULNERABLE_DAMAGE_BONUS_PERCENT / 100 : 1;
}

/**
 * "Death ward": while present, ordinary damage (dealDamage, not Valeur Lock)
 * can never bring the bearer's current HP below 1. Checked directly in
 * match.ts's dealDamage handler -- like atk-boost/atk-reduction, this is a
 * generic engine-recognized status rather than a per-card modifier, since a
 * one-shot object card's own `modifiers` stop being scanned the instant it
 * leaves play (see match.ts::handlePlayObject).
 */
export function hasDeathWard(char: CharacterInstance): boolean {
  return hasStatus(char, 'death-ward');
}

/**
 * "Attaque cloné": while the granted follow-up attack is armed, that attack lands at
 * `data.damagePercent`% of its normal number. Returns 1 (no-op) the rest of the time --
 * including while the grant is merely pending, so the FIRST attack is at full strength.
 * A dedicated field rather than an 'atk-multiplier' status, which would collide with the
 * x2 of Adrénaline Ultime (removing one would remove both).
 */
export function getExtraAttackDamageMultiplier(char: CharacterInstance): number {
  const grant = getStatus(char, 'extra-attack');
  if (!grant || grant.data?.['armed'] !== true) return 1;
  return Math.max(0, Number(grant.data?.['damagePercent'] ?? 100)) / 100;
}

/**
 * "Jacob et Essau": the other half of a linked pair, or undefined when the bearer isn't
 * linked. The pairing is symmetric -- both characters carry the status pointing at the
 * other -- so this is the single lookup every one of the bond's four rules goes through
 * (joint attack, mirrored damage, shared death, abilities reserved to the active one).
 */
export function getLinkedPartnerId(char: CharacterInstance): string | undefined {
  const partnerId = getStatus(char, 'linked')?.data?.['partnerInstanceId'];
  return typeof partnerId === 'string' ? partnerId : undefined;
}

export function isSilencedActive(char: CharacterInstance): boolean {
  return hasStatus(char, 'silence-active') || hasStatus(char, 'silence-ultimate');
}

export function isSilencedPassive(char: CharacterInstance): boolean {
  return hasStatus(char, 'silence-passive') || hasStatus(char, 'silence-ultimate');
}

export function getAtkReductionTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-reduction')
    .reduce((sum, s) => sum + Number(s.data?.['amount'] ?? 0), 0);
}

/** Symmetric counterpart to getAtkReductionTotal: sums every active "atk-boost" status's { amount }. */
export function getAtkBoostTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-boost')
    .reduce((sum, s) => sum + Number(s.data?.['amount'] ?? 0), 0);
}

/** Multiplicative counterpart to atk-boost/atk-reduction (e.g. Adrénaline Ultime's x2) -- stacks multiplicatively, defaults to 1 (no-op) with none present. Applied after the additive boost/reduction total in getEffectiveATK. */
export function getAtkMultiplierTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-multiplier')
    .reduce((product, s) => product * Number(s.data?.['multiplier'] ?? 1), 1);
}

/**
 * Bleed: a generic engine-recognized status (like death-ward/atk-boost) rather
 * than per-card logic. Applying it while one is already present adds stacks
 * (capped at BLEED_MAX_STACKS) instead of pushing a second entry. It deals its
 * stack-scaled damage once, at the start of the bearer's NEXT turn (always
 * ticks, even benched -- see tickStatusesAtTurnStart), then is consumed
 * (removed) regardless of whether it dealt damage. Any `heal()` call on the
 * bearer cures it immediately (see match.ts's `heal` handler), before it ever
 * gets to tick.
 */
export function getBleedStacks(char: CharacterInstance): number {
  return Number(getStatus(char, 'bleed')?.data?.['stacks'] ?? 0);
}

export function applyStatus(char: CharacterInstance, status: StatusInstance): void {
  if (status.statusId === 'bleed') {
    const incoming = Math.max(1, Math.round(Number(status.data?.['stacks'] ?? 1)));
    const existing = getStatus(char, 'bleed');
    if (existing) {
      const current = Number(existing.data?.['stacks'] ?? 1);
      existing.data = { ...existing.data, stacks: Math.min(BLEED_MAX_STACKS, current + incoming) };
      return;
    }
    char.statuses.push({ ...status, data: { ...status.data, stacks: Math.min(BLEED_MAX_STACKS, incoming) } });
    return;
  }

  // Burn/Poison: like bleed, re-applying while one is already present refreshes the
  // existing instance instead of pushing a second one. Both tick a FIXED amount every
  // turn regardless of remainingTurns (see tickStatusesAtTurnStart) rather than a
  // stack-scaled one, so two independent instances didn't stack damage -- they silently
  // doubled it, ticking twice in the same turn for no visible reason on the card.
  //
  // Where the two differ is what a re-application does to the countdown:
  //  - burn ACCUMULATES (les durées s'additionnent) -- re-brûler une cible déjà en feu
  //    allonge l'incendie, c'est la façon dont la brûlure "stack" ;
  //  - poison takes the longer of the two, so re-poisoning never shortens the existing
  //    countdown but ne boule pas de neige non plus.
  // An absent `remainingTurns` means "indefinite" on either side: it stays indefinite.
  if (status.statusId === 'burn' || status.statusId === 'poison') {
    const existing = getStatus(char, status.statusId);
    if (existing) {
      existing.label = status.label;
      existing.sourcePlayerId = status.sourcePlayerId;
      existing.sourceCardInstanceId = status.sourceCardInstanceId;
      existing.data = status.data;
      if (status.remainingTurns === undefined || existing.remainingTurns === undefined) {
        existing.remainingTurns = undefined;
      } else if (status.statusId === 'burn') {
        existing.remainingTurns += status.remainingTurns;
      } else {
        existing.remainingTurns = Math.max(existing.remainingTurns, status.remainingTurns);
      }
      return;
    }
  }

  char.statuses.push(status);
}

export function removeStatus(char: CharacterInstance, statusId: string): void {
  char.statuses = char.statuses.filter((s) => s.statusId !== statusId);
}

/**
 * Section 6: durations count down only during the AFFECTED player's own
 * turns. They're suspended while the bearer sits on the bench, except
 * Poison/Burn/Bleed which always tick (and deal their damage) at the start of
 * the affected player's turn regardless of bench/active.
 */
export async function tickStatusesAtTurnStart(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  const player = state.players[playerId];
  const allInstanceIds = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
    (id): id is string => id !== null
  );

  for (const instanceId of allInstanceIds) {
    const char = player.characters[instanceId];
    if (!char) continue;
    const isActive = instanceId === player.activeCharacterInstanceId;
    let bledThisTurn = false;

    for (const status of [...char.statuses]) {
      // A tick can KO the bearer (burn finishing off a low-HP character) -- once it has
      // left the board, the remaining statuses must not keep hitting the corpse or
      // counting down. Re-checked every iteration since ticks resolve asynchronously.
      if (!api.isOnBoard(instanceId)) break;
      // Another effect resolved during an awaited tick may have removed this status
      // (a heal curing bleed, a cleanse); don't tick or decrement a status that is
      // no longer on the character.
      if (!char.statuses.includes(status)) continue;

      // Poison/Burn/Bleed are the documented exception that keeps *dealing damage* on the
      // bench. `ticksOnBench` is the weaker, opt-in version a card can set on any status:
      // the duration keeps counting down while benched (no damage implied), so a buff
      // whose text is scoped to a turn ("pendant ce tour") can't be parked on the bench
      // to freeze it forever.
      const damagesOnBench = status.statusId === 'burn' || status.statusId === 'poison' || status.statusId === 'bleed';
      const countsDownOnBench = damagesOnBench || status.ticksOnBench === true;
      if (!isActive && !countsDownOnBench) continue; // suspended while benched

      if (damagesOnBench) {
        let amount: number;
        if (status.statusId === 'burn') amount = BURN_DAMAGE;
        else if (status.statusId === 'poison') amount = POISON_FLAT_DAMAGE + Math.round(char.currentMaxHP * POISON_PERCENT_OF_MAX_HP);
        else amount = Math.round(char.currentMaxHP * BLEED_PERCENT_PER_STACK * Number(status.data?.['stacks'] ?? 1));

        if (amount > 0) {
          // Poison only: a card's modifier (e.g. Muzan's "Sang Maudit") can redirect
          // this specific tick into an unhealable max-HP loss instead -- re-checked
          // fresh every tick, so it only applies for whichever ticks currently
          // qualify (see cards/demo/muzan.ts).
          if (status.statusId === 'poison' && api.poisonTicksAsValeurLock(instanceId)) {
            api.log(`${cardName(char.cardId)} : le poison (Sang Maudit) retire ${amount} HP max`, { kind: 'status-tick', characterInstanceId: instanceId, statusId: status.statusId, amount });
            await api.applyValeurLock(instanceId, amount);
          } else {
            api.log(`${cardName(char.cardId)} subit ${amount} dégâts de ${STATUS_TICK_LABELS[status.statusId] ?? status.statusId}`, { kind: 'status-tick', characterInstanceId: instanceId, statusId: status.statusId, amount });
            await api.dealDamage(instanceId, amount, { source: status.statusId });
          }
        }

        // Bleed is a one-shot delayed hit, not a countdown: it's consumed the
        // instant it ticks, regardless of remainingTurns (it has none).
        if (status.statusId === 'bleed') bledThisTurn = true;
      }

      if (status.remainingTurns !== undefined) {
        status.remainingTurns -= 1;
      }
    }

    const expired = char.statuses.filter((s) => s.remainingTurns !== undefined && s.remainingTurns <= 0);
    char.statuses = char.statuses.filter((s) => s.remainingTurns === undefined || s.remainingTurns > 0);
    if (bledThisTurn) removeStatus(char, 'bleed');

    for (const status of expired) {
      // Hand-off: a status can arm another one on its way out ("Attaque cloné" silences its
      // user only once the extra-attack window has closed). Applied here, after the
      // decrement pass above, so the newcomer isn't ticked on arrival -- its duration
      // starts at the bearer's next turn, which is why it needs no `+1`.
      if (status.onExpire && api.isOnBoard(instanceId)) {
        applyStatus(char, { ...status.onExpire });
      }
      // Same convention as 'damage-reflect' (data.objectInstanceId), but for a status that
      // is consumed by TIME instead of by a hit: whichever object carried this status is
      // destroyed the moment the status itself naturally expires. destroyObject is a no-op
      // if the object already left play some other way. Used by "Attaque cloné" so its
      // equipped object doesn't linger, inert, once the silence it grants runs out.
      const objectInstanceId = status.data?.['objectInstanceId'];
      if (typeof objectInstanceId === 'string') {
        api.destroyObject(objectInstanceId);
      }
      await api.emitEvent({
        name: 'onStatusExpired',
        playerId,
        data: { characterInstanceId: instanceId, statusId: status.statusId },
      });
    }
  }
}
