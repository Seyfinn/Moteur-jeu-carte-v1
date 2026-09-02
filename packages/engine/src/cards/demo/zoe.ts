import type { CharacterCardDef, EffectContext } from '../types.js';
import { getCharacterCard } from '../registry.js';
import { hasStatus } from '../../statuses.js';

const BASE_ATK = 50;
const SILENCE_CHANCE_PERCENT = 33;
const PORTAL_USES_PER_GAME = 2;

/**
 * Un statut posé sur l'ENNEMI pendant le tour de Zoé subit son premier tick au
 * début du tour suivant (celui de la cible, immédiatement après). Un statut posé
 * sur SOI-MÊME pendant son propre tour ne subit son premier tick qu'à son propre
 * tour suivant (l'adversaire s'intercale sans jamais le faire tiquer). Dans les
 * deux cas, remainingTurns doit donc dépasser de 1 le nombre de tours à bloquer
 * réellement (voir statuses.ts, tickStatusesAtTurnStart : décrémente PUIS filtre,
 * avant que le joueur actif ne puisse agir ce tour-là -- sinon l'effet est retiré
 * avant même d'avoir pu compter).
 */
const SILENCE_EFFECTIVE_TURNS = 1; // ciblé sur l'ennemi -> +1
const SILENCE_REMAINING_TURNS = SILENCE_EFFECTIVE_TURNS + 1;
const SPELL_THIEF_COOLDOWN_EFFECTIVE_TURNS = 3; // posé sur soi-même -> +1
const SPELL_THIEF_COOLDOWN_REMAINING_TURNS = SPELL_THIEF_COOLDOWN_EFFECTIVE_TURNS + 1;

const SPELL_THIEF_COOLDOWN_STATUS_ID = 'zoe-spell-thief-cooldown';

/**
 * La capacité active que Zoé peut voler à l'instant T, ou `undefined`. Le moteur retient
 * lui-même la dernière capacité **activée manuellement** par chaque camp
 * (`PlayerState.lastAbilityUsed`, écrite avant l'exécution) : une capacité qui stun ou
 * silence Zoé en se résolvant -- le Menu Surprise de Soma -- ne peut donc plus l'empêcher
 * d'en prendre note, ce qui la rendait tout simplement involable.
 *
 * Les passives à trigger ne passent pas par ce chemin : Spell Thief reste naturellement
 * limité aux "actifs", sans code de filtrage en plus.
 */
function stealableAbility(ctx: EffectContext) {
  const record = ctx.state.players[ctx.opponentId].lastAbilityUsed;
  if (!record) return undefined;
  const caster = ctx.state.players[ctx.opponentId].characters[record.characterInstanceId];
  if (!caster) return undefined;
  // Le personnage d'origine a pu changer de forme depuis : on ne vole que ce qu'il porte
  // encore réellement.
  const ability = getCharacterCard(caster.cardId).abilities.find((a) => a.id === record.abilityId);
  return ability ? { ability, casterInstanceId: caster.instanceId } : undefined;
}

export const zoe: CharacterCardDef = {
  type: 'character',
  id: 'zoe',
  name: 'Zoé',
  baseMaxHP: 140,
  attacks: [
    {
      id: 'sleepy-bubble',
      name: 'Sleepy Bubble',
      baseATK: BASE_ATK,
      description: `Inflige ${BASE_ATK} dégâts à l'actif adverse. Si des dégâts passent, ${SILENCE_CHANCE_PERCENT}% de chance d'appliquer Silence Ultime pendant ${SILENCE_EFFECTIVE_TURNS} tour.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && ctx.rollChance(SILENCE_CHANCE_PERCENT, 'Silence Ultime', { characterInstanceId: target.instanceId })) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'silence-ultimate',
            label: 'Silence Ultime (Sleepy Bubble)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: SILENCE_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'portail-dimensionnel',
      name: 'Portail Dimensionnel',
      kind: 'active',
      description: `Switch gratuitement avec un personnage du banc allié de votre choix. ${PORTAL_USES_PER_GAME} utilisations maximum par partie.`,
      usesPerGame: PORTAL_USES_PER_GAME,
      async execute(ctx) {
        const bench = ctx.getBench(ctx.ownerId);
        if (bench.length === 0) return;
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Portail Dimensionnel : choisissez le personnage du banc à faire entrer en jeu',
          options: bench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;
        await ctx.forceSwitch(ctx.ownerId, targetId);
      },
    },
    {
      id: 'spell-thief',
      name: 'Spell Thief',
      kind: 'active',
      description: `Rejoue immédiatement la dernière capacité active utilisée par l'adversaire, mais lancée par Zoé. Rechargement : ${SPELL_THIEF_COOLDOWN_EFFECTIVE_TURNS} tours.`,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (hasStatus(self, SPELL_THIEF_COOLDOWN_STATUS_ID)) return false;
        return !!stealableAbility(ctx);
      },
      async execute(ctx) {
        const stolen = stealableAbility(ctx);
        if (!stolen) return;

        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: SPELL_THIEF_COOLDOWN_STATUS_ID,
          label: 'Spell Thief (recharge)',
          remainingTurns: SPELL_THIEF_COOLDOWN_REMAINING_TURNS,
          // Une recharge d'ability descend même au banc : sinon un personnage mis de côté
          // gèlerait son propre compte à rebours, et « rechargement : N tours » voudrait
          // dire « N tours passés au poste actif ».
          ticksOnBench: true,
        });

        ctx.log(`Spell Thief : Zoé utilise ${stolen.ability.name}`, {
          abilityId: stolen.ability.id,
          stolenFrom: stolen.casterInstanceId,
        });
        await stolen.ability.execute(ctx);
      },
    },
  ],
};
