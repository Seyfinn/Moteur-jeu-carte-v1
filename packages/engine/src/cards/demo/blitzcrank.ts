import type { CharacterCardDef, EffectContext } from '../types.js';
import { simpleAttack } from './shared.js';
import { hasStatus } from '../../statuses.js';
import { canTargetBench, findCharacter } from '../../queries.js';

const SHIELD_STATUS_ID = 'blitzcrank-mana-barrier-shield';
const HOOK_LOCK_STATUS_ID = 'blitzcrank-hook-locked';
const SHIELD_AMOUNT = 150;
const HP_THRESHOLD = 50;
const HOOK_LOCK_TURNS = 2;

/** Bench targets Hook is allowed to pull, excluding any protected by e.g. Bouclier Ultime. */
function getHookableBench(ctx: EffectContext) {
  return ctx
    .getBench(ctx.opponentId)
    .filter((c) => canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow);
}

export const blitzcrank: CharacterCardDef = {
  type: 'character',
  id: 'blitzcrank',
  name: 'Blitzcrank',
  baseMaxHP: 250,
  attacks: [simpleAttack('poing-dacier', "Poing d'acier", 50, "Inflige 50 dégâts à l'actif adverse.")],
  abilities: [
    {
      id: 'mana-barrier',
      name: 'Mana Barrier',
      kind: 'passive',
      description: `Si Blitzcrank tombe sous ${HP_THRESHOLD}HP, il gagne un bouclier absorbant ${SHIELD_AMOUNT} points de dégâts, mais Hook est verrouillé pendant ${HOOK_LOCK_TURNS} tours. Ne se déclenche qu'une seule fois par partie.`,
      trigger: 'afterDamage',
      // Doit pouvoir se déclencher même si Blitzcrank encaisse les dégâts depuis le banc (AoE).
      usableFromBench: true,
      usesPerGame: 1,
      condition(ctx) {
        const event = ctx.event;
        if (!event || event.data['targetInstanceId'] !== ctx.sourceInstanceId) return false;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const currentHP = self.currentMaxHP - self.damage;
        return currentHP > 0 && currentHP < HP_THRESHOLD;
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: SHIELD_STATUS_ID,
          label: 'Bouclier (Mana Barrier)',
          sourceCardInstanceId: ctx.sourceInstanceId,
          // `data.shield` est la convention lue par le client : réserve chiffrée sur le
          // badge, segment sur la barre de vie et halo, comme le bouclier natif du moteur.
          data: { shield: SHIELD_AMOUNT },
        });
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: HOOK_LOCK_STATUS_ID,
          label: 'Hook verrouillé',
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: HOOK_LOCK_TURNS,
        });
        ctx.log(`Mana Barrier se déclenche : bouclier de ${SHIELD_AMOUNT} et Hook verrouillé ${HOOK_LOCK_TURNS} tours`, {
          characterInstanceId: ctx.sourceInstanceId,
        });
      },
    },
    {
      id: 'hook',
      name: 'Hook',
      kind: 'active',
      description: 'Une fois par partie, ramène un personnage ennemi du banc sur le poste actif.',
      usesPerGame: 1,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (hasStatus(self, HOOK_LOCK_STATUS_ID)) return false;
        return getHookableBench(ctx).length > 0;
      },
      async execute(ctx) {
        const benchOptions = getHookableBench(ctx);
        const selected = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Hook : choisissez le personnage ennemi à ramener en poste actif',
          options: benchOptions.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        const targetId = selected[0];
        if (!targetId) return;
        await ctx.forceSwitch(ctx.opponentId, targetId);
      },
    },
  ],
  modifiers: [
    {
      // Bouclier absorbant : consomme les dégâts entrants sur Blitzcrank jusqu'à épuisement du pool,
      // l'excédent d'un coup qui dépasse le reste du bouclier passe sur les vrais HP dans le même coup.
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        if (ctx.query['targetInstanceId'] !== ctx.sourceInstanceId) return current;
        const amount = current as number;
        const char = findCharacter(ctx.state, ctx.sourceInstanceId);
        const shield = char.statuses.find((s) => s.statusId === SHIELD_STATUS_ID);
        if (!shield) return amount;
        const remaining = Number(shield.data?.['shield'] ?? 0);
        if (remaining <= 0) return amount;
        const absorbed = Math.min(remaining, amount);
        const newRemaining = remaining - absorbed;
        if (newRemaining <= 0) {
          char.statuses = char.statuses.filter((s) => s !== shield);
        } else {
          shield.data = { ...shield.data, shield: newRemaining };
        }
        return amount - absorbed;
      },
    },
  ],
};
