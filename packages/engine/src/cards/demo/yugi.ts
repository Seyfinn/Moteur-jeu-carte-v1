import type { CharacterCardDef, EffectContext } from '../types.js';
import { simpleAttack } from './shared.js';
import { getCharacterCard } from '../registry.js';
import { randomInt } from '../../rng.js';

const ATTACK_ATK = 50;

const ATK_BOOST_AMOUNT = 30;
const BLEED_STACKS = 2;
const SELF_HEAL_AMOUNT = 70;
const BENCH_HEAL_AMOUNT = 50;
const REFLECT_PERCENT = 100;
const REVIVE_HP_PERCENT = 50;
const REVIVE_FALLBACK_HEAL = 100;

// Poids exacts imprimés sur la carte -- une seule source de vérité, réutilisée à la fois
// dans `OUTCOMES` (le tirage) et dans `description` (le texte affiché).
const ATK_BOOST_ROLL_PERCENT = 40;
const BLEED_ROLL_PERCENT = 20;
const HEAL_ROLL_PERCENT = 15;
const REFLECT_ROLL_PERCENT = 4;
const REVIVE_ROLL_PERCENT = 1;
const FAIL_ROLL_PERCENT = 20; // 40+20+15+4+1+20 = 100

async function boostAtk(ctx: EffectContext): Promise<void> {
  // « durant un tour » : le tour EN COURS (comme Potion force), pas le prochain -- posé
  // pendant le tour de Yugi, donc avant son propre tick, remainingTurns: 1 suffit (pas de
  // +1, qui ne s'applique qu'à un statut posé APRÈS le tick de son porteur).
  ctx.applyStatus(ctx.sourceInstanceId, {
    statusId: 'atk-boost',
    label: `Puzzle Millénaire (+${ATK_BOOST_AMOUNT} ATK)`,
    sourceCardInstanceId: ctx.sourceInstanceId,
    remainingTurns: 1,
    data: { amount: ATK_BOOST_AMOUNT },
  });
}

async function applyBleedOnEnemy(ctx: EffectContext): Promise<void> {
  const enemy = ctx.getActive(ctx.opponentId);
  if (!enemy) return;
  ctx.applyStatus(enemy.instanceId, {
    statusId: 'bleed',
    label: 'Bleed (Puzzle Millénaire)',
    sourceCardInstanceId: ctx.sourceInstanceId,
    data: { stacks: BLEED_STACKS },
  });
}

async function healSelfOrBenchAlly(ctx: EffectContext): Promise<void> {
  const bench = ctx.getBench(ctx.ownerId);
  if (bench.length === 0) {
    ctx.heal(ctx.sourceInstanceId, SELF_HEAL_AMOUNT);
    return;
  }
  // Soi-même en tête : un choix laissé sans réponse (120 s) tombe sur la première option.
  const [targetId] = await ctx.choose({
    kind: 'select-characters',
    prompt: 'Puzzle Millénaire : vous soigner, ou soigner un allié du banc ?',
    options: [ctx.sourceInstanceId, ...bench.map((c) => c.instanceId)],
    min: 1,
    max: 1,
  });
  if (!targetId) return;
  if (targetId === ctx.sourceInstanceId) ctx.heal(ctx.sourceInstanceId, SELF_HEAL_AMOUNT);
  else ctx.heal(targetId, BENCH_HEAL_AMOUNT);
}

async function armTotalReflect(ctx: EffectContext): Promise<void> {
  // 100 % de renvoi ET le porteur n'encaisse rien du coup lui-même : `negatesOriginal`
  // (voir CLAUDE.md), que Miroir de Renvoi ne pose jamais.
  ctx.applyStatus(ctx.sourceInstanceId, {
    statusId: 'damage-reflect',
    label: 'Puzzle Millénaire (Renvoi total)',
    sourceCardInstanceId: ctx.sourceInstanceId,
    data: { percent: REFLECT_PERCENT, negatesOriginal: true },
  });
}

async function reviveOrFallbackHeal(ctx: EffectContext): Promise<void> {
  const owner = ctx.state.players[ctx.ownerId];
  const graveyard = owner.graveyardCharacterInstanceIds;
  if (graveyard.length === 0) {
    ctx.heal(ctx.sourceInstanceId, REVIVE_FALLBACK_HEAL);
    return;
  }
  const options = graveyard.map((id) => {
    const cardId = owner.characters[id]?.cardId ?? '';
    return { key: id, label: getCharacterCard(cardId).name, card: { cardId, kind: 'character' as const } };
  });
  const chosen = await ctx.chooseOption('Puzzle Millénaire : ressusciter quel personnage sur le banc ?', options);
  const target = owner.characters[chosen];
  if (!target) return;
  const reviveHP = Math.floor(target.currentMaxHP * (REVIVE_HP_PERCENT / 100));
  await ctx.reviveCharacter(chosen, reviveHP, 'bench');
}

interface RollOutcome {
  weight: number;
  label: string;
  run(ctx: EffectContext): Promise<void>;
}

// Poids exacts imprimés sur la carte (40+20+15+4+1+20 = 100). Pas de roue à pourcentage
// ici : ProcWheel ne sait montrer qu'un jet à 2 issues (réussi/raté sur UN taux), pas un
// tirage à 6 branches inégales -- le tirage est donc silencieux, et la ligne de journal
// ci-dessous dit exactement ce qui a été obtenu.
const OUTCOMES: RollOutcome[] = [
  { weight: ATK_BOOST_ROLL_PERCENT, label: `Boost l'ATK de ${ATK_BOOST_AMOUNT} durant ce tour`, run: boostAtk },
  { weight: BLEED_ROLL_PERCENT, label: `Applique ${BLEED_STACKS} stacks de Bleed sur l'ennemi`, run: applyBleedOnEnemy },
  {
    weight: HEAL_ROLL_PERCENT,
    label: `Soigne Yugi de ${SELF_HEAL_AMOUNT} HP ou un allié du banc de ${BENCH_HEAL_AMOUNT} HP`,
    run: healSelfOrBenchAlly,
  },
  {
    weight: REFLECT_ROLL_PERCENT,
    label: `Renvoie ${REFLECT_PERCENT}% des dégâts de la prochaine attaque subie, sans les subir`,
    run: armTotalReflect,
  },
  {
    weight: REVIVE_ROLL_PERCENT,
    label: `Ressuscite un allié du cimetière à ${REVIVE_HP_PERCENT}% de ses PV (ou soigne Yugi de ${REVIVE_FALLBACK_HEAL} HP si le cimetière est vide)`,
    run: reviveOrFallbackHeal,
  },
  { weight: FAIL_ROLL_PERCENT, label: 'Échec (rien ne se passe)', run: async () => {} },
];

export const yugi: CharacterCardDef = {
  type: 'character',
  id: 'yugi',
  name: 'Yugi',
  baseMaxHP: 200,
  attacks: [simpleAttack('appel-du-magicien-sombre', 'Appel du Magicien Sombre', ATTACK_ATK, '')],
  abilities: [
    {
      id: 'puzzle-millenaire',
      name: 'Puzzle Millénaire',
      kind: 'active',
      description:
        `Obtient aléatoirement l'un des effets suivants à qu'il pourra utiliser quand il le souhaite une fois par tour :
40 % : Boost l'ATK de 30 durant un tour.
20 % : Applique 2 bleed sur l'ennemi.
15 % : Se soigne de 70 HP ou soigne un allié sur le banc de 50 HP.
4 % : Renvoie 100 % des dégâts de la prochaine attaque subie à l'attaquant et ne les subit pas.
1 % : Ressuscite un personnage allié de votre cimetière sur votre banc avec 50 % de ses PV. Si le cimetière est vide, soigne Yugi de 100 HP.
20 % : Échec (rien ne se passe).`,
      usesPerTurn: 1,
      async execute(ctx) {
        const roll = randomInt(ctx.state.rng, 100);
        let cumulative = 0;
        let outcome = OUTCOMES[OUTCOMES.length - 1]!;
        for (const candidate of OUTCOMES) {
          cumulative += candidate.weight;
          if (roll < cumulative) {
            outcome = candidate;
            break;
          }
        }
        ctx.log(`Puzzle Millénaire : ${outcome.label}`, { kind: 'info' });
        await outcome.run(ctx);
      },
    },
  ],
};
