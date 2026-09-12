import type { AttackDef, CharacterCardDef, EffectContext } from '../types.js';
import { findAttackFor } from '../../queries.js';
import { EVASIVE_STATUS_CHANCE_PERCENT, getStatus } from '../../statuses.js';

const RAIKIRI_ATK = 60;

const LAST_ENEMY_ATTACK_STATUS_ID = 'kakashi-last-enemy-attack';
/** Même lecture que L'Infini de Gojo : « l'effet Esquive », donc le taux du moteur. */
const SHARINGAN_EVASION_PERCENT = EVASIVE_STATUS_CHANCE_PERCENT;

/**
 * L'attaque mémorisée, telle que son auteur la porterait AUJOURD'HUI. `findAttackFor` et
 * pas `getCharacterCard(...).attacks` : l'ennemi a pu attaquer avec une attaque empruntée
 * (Livre de Chrollo), qui n'est pas sur sa carte -- sans ça, Copie de Technique ne trouvait
 * rien et brûlait son unique utilisation pour rien. Partagé entre `condition` et `execute`
 * pour que la capacité soit grisée exactement quand elle n'aurait rien à rejouer.
 */
function rememberedAttack(ctx: EffectContext): AttackDef | undefined {
  const record = getStatus(ctx.getCharacter(ctx.sourceInstanceId), LAST_ENEMY_ATTACK_STATUS_ID);
  const characterInstanceId = record?.data?.['characterInstanceId'];
  const attackId = record?.data?.['attackId'];
  if (typeof characterInstanceId !== 'string' || typeof attackId !== 'string') return undefined;
  try {
    return findAttackFor(ctx.state, characterInstanceId, attackId);
  } catch {
    return undefined; // plus disponible (ex: le personnage d'origine a changé de forme depuis)
  }
}

export const kakashi: CharacterCardDef = {
  type: 'character',
  id: 'kakashi',
  name: 'Kakashi',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'raikiri',
      name: 'Raikiri',
      baseATK: RAIKIRI_ATK,
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, RAIKIRI_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'sharingan',
      name: 'Sharingan',
      kind: 'passive',
      description: "Kakashi bénéficie de l'effet Esquive",
      // Purement descriptive : implémentée par le modifier 'getEvasionPercent' plus bas
      // (même mécanisme que L'Infini de Gojo).
      async execute() {},
    },
    {
      // Bookkeeping pur : mémorise la dernière attaque de l'ennemi pour Copie de
      // Technique ci-dessous. Miroir exact du tracker de Spell Thief (zoe.ts), mais sur
      // onAttackDeclared plutôt que onAbilityUsed.
      id: 'copie-de-technique-tracker',
      name: 'Copie de Technique (mémoire)',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "Retient la dernière attaque utilisée par l'ennemi, pour Copie de Technique.",
      trigger: 'onAttackDeclared',
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        const data = ctx.event!.data as { characterInstanceId: string; attackId: string };
        ctx.removeStatus(ctx.sourceInstanceId, LAST_ENEMY_ATTACK_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: LAST_ENEMY_ATTACK_STATUS_ID,
          label: 'Copie de Technique (mémoire)',
          hidden: true, // mémoire interne, aucune information utile à afficher sur la carte
          data: { characterInstanceId: data.characterInstanceId, attackId: data.attackId },
        });
      },
    },
    {
      id: 'copie-de-technique',
      name: 'Copie de Technique',
      kind: 'active',
      description:
        "Utilisation Unique : Copie la dernière attaque utilisée par l'adversaire lors de la partie et l'exécute immédiatement.",
      usesPerGame: 1,
      condition(ctx) {
        return !!rememberedAttack(ctx);
      },
      async execute(ctx) {
        const stolenAttack = rememberedAttack(ctx);
        if (!stolenAttack) return;
        const record = getStatus(ctx.getCharacter(ctx.sourceInstanceId), LAST_ENEMY_ATTACK_STATUS_ID);

        ctx.log(`Copie de Technique : Kakashi utilise ${stolenAttack.name}`, {
          attackId: stolenAttack.id,
          stolenFrom: record?.data?.['characterInstanceId'],
        });
        await stolenAttack.execute(ctx);
      },
    },
  ],
  modifiers: [
    {
      // "Sharingan" : esquive innée permanente, actif ou au banc.
      // Passive imprimée, donc coupée par le silence passif / ultime (cf. L'Infini).
      query: 'getEvasionPercent',
      silencedByPassive: true,
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, SHARINGAN_EVASION_PERCENT);
      },
    },
  ],
};
