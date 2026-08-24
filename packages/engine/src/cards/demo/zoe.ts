import type { CharacterCardDef } from '../types.js';
import { getCharacterCard } from '../registry.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { chancePercent } from '../../rng.js';

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

const LAST_ENEMY_ABILITY_STATUS_ID = 'zoe-last-enemy-ability';
const SPELL_THIEF_COOLDOWN_STATUS_ID = 'zoe-spell-thief-cooldown';

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
      description: `Inflige ${BASE_ATK} dégâts à l'actif adverse. Si des dégâts passent réellement (pas d'esquive), ${SILENCE_CHANCE_PERCENT}% de chance d'appliquer Silence Ultime pendant ${SILENCE_EFFECTIVE_TURNS} tour.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && chancePercent(ctx.state.rng, SILENCE_CHANCE_PERCENT)) {
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
      // Bookkeeping pur : mémorise la dernière ability active de l'ennemi pour Spell
      // Thief ci-dessous. onAbilityUsed n'est émis (voir match.ts::handleUseAbility)
      // que pour les abilities manuellement activées -- jamais pour les passives à
      // trigger, qui de toute façon ne peuvent pas être déclenchées manuellement
      // (voir CLAUDE.md, "Bug du moteur corrigé"). Ça restreint donc naturellement
      // Spell Thief aux abilities "actives simples", sans code de filtrage en plus.
      id: 'spell-thief-tracker',
      name: 'Spell Thief (mémoire)',
      kind: 'passive',
      description: "Retient la dernière ability active utilisée par l'ennemi, pour Spell Thief.",
      trigger: 'onAbilityUsed',
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        const data = ctx.event!.data as { characterInstanceId: string; abilityId: string };
        ctx.removeStatus(ctx.sourceInstanceId, LAST_ENEMY_ABILITY_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: LAST_ENEMY_ABILITY_STATUS_ID,
          label: 'Spell Thief (mémoire)',
          hidden: true, // mémoire interne, aucune information utile à afficher sur la carte
          data: { characterInstanceId: data.characterInstanceId, abilityId: data.abilityId },
        });
      },
    },
    {
      id: 'spell-thief',
      name: 'Spell Thief',
      kind: 'active',
      description: `Rejoue immédiatement la dernière capacité active utilisée par l'adversaire, mais lancée par Zoé. Une capacité qui dépend d'un compteur propre à son porteur d'origine peut être moins efficace. Rechargement : ${SPELL_THIEF_COOLDOWN_EFFECTIVE_TURNS} tours.`,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (hasStatus(self, SPELL_THIEF_COOLDOWN_STATUS_ID)) return false;
        return !!getStatus(self, LAST_ENEMY_ABILITY_STATUS_ID);
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: SPELL_THIEF_COOLDOWN_STATUS_ID,
          label: 'Spell Thief (recharge)',
          remainingTurns: SPELL_THIEF_COOLDOWN_REMAINING_TURNS,
        });

        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const record = getStatus(self, LAST_ENEMY_ABILITY_STATUS_ID);
        const characterInstanceId = record?.data?.['characterInstanceId'] as string | undefined;
        const abilityId = record?.data?.['abilityId'] as string | undefined;
        if (!characterInstanceId || !abilityId) return;

        const stolenCardId = ctx.getCharacter(characterInstanceId).cardId;
        const stolenAbility = getCharacterCard(stolenCardId).abilities.find((a) => a.id === abilityId);
        if (!stolenAbility) return; // plus disponible (ex: le personnage d'origine a changé de forme depuis)

        ctx.log(`Spell Thief : Zoé utilise ${stolenAbility.name}`, { abilityId, stolenFrom: characterInstanceId });
        await stolenAbility.execute(ctx);
      },
    },
  ],
};
