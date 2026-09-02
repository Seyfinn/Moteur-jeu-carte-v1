import type { CharacterCardDef, EffectContext } from '../types.js';
import { getStatus } from '../../statuses.js';

const ARGILE_ATK = 60;

const BOMBE_ARGILE_STATUS_ID = 'deidara-bombe-argile';
const BOMBE_ARGILE_MAX_STACKS = 3;

const KATSU_ACTIVE_DAMAGE_BY_STACKS: Record<number, number> = { 1: 50, 2: 80, 3: 120 };
const KATSU_BENCH_TARGET_DAMAGE = 40;
const KATSU_BENCH_SPLASH_DAMAGE = 20;

/** Cherche l'unique porteur adverse de Bombe d'Argile, s'il y en a un. */
function findBombCarrier(ctx: EffectContext) {
  for (const enemy of ctx.getAllOnBoard(ctx.opponentId)) {
    const status = getStatus(enemy, BOMBE_ARGILE_STATUS_ID);
    if (status) return { instanceId: enemy.instanceId, status };
  }
  return null;
}

export const deidara: CharacterCardDef = {
  type: 'character',
  id: 'deidara',
  name: 'Deidara',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'argile-explosive-c1',
      name: 'Argile Explosive C1',
      baseATK: ARGILE_ATK,
      description: "applique le statut Bombe d'Argile à la cible. (Une seule cible peut porter ce statut à la fois).",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, ARGILE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (!landed) return;

        // "Une seule cible à la fois" : si un AUTRE ennemi porte déjà la bombe, elle se
        // déplace sur la nouvelle cible touchée (l'ancien porteur perd tout).
        for (const enemy of ctx.getAllOnBoard(ctx.opponentId)) {
          if (enemy.instanceId !== target.instanceId) ctx.removeStatus(enemy.instanceId, BOMBE_ARGILE_STATUS_ID);
        }

        const existing = getStatus(ctx.getCharacter(target.instanceId), BOMBE_ARGILE_STATUS_ID);
        const stacks = Math.min(Number(existing?.data?.['stacks'] ?? 0) + 1, BOMBE_ARGILE_MAX_STACKS);
        ctx.removeStatus(target.instanceId, BOMBE_ARGILE_STATUS_ID);
        ctx.applyStatus(target.instanceId, {
          statusId: BOMBE_ARGILE_STATUS_ID,
          label: `Bombe d'Argile (${stacks})`,
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { stacks },
        });
      },
    },
  ],
  abilities: [
    {
      id: 'detonation-katsu',
      name: 'Détonation : Katsu !',
      kind: 'active',
      description:
        "Utilisable depuis le banc\nDeidara fait exploser le personnage adverse qui porte le statut Bombe d'Argile. L'effet change selon la position de la cible \nSi la cible est sur le poste actif : L'explosion est concentrée et lui inflige 50 dégâts pour une bombe \n80 pour 2 bombes\n120 pour 3 bombes\nSi la cible est sur le banc : inflige 40 dégâts à la cible ET 20 dégâts à tous ses alliés",
      usableFromBench: true,
      condition(ctx) {
        return !!findBombCarrier(ctx);
      },
      async execute(ctx) {
        const carrier = findBombCarrier(ctx);
        if (!carrier) return;
        const { instanceId: targetId, status } = carrier;
        const stacks = Math.min(Number(status.data?.['stacks'] ?? 1), BOMBE_ARGILE_MAX_STACKS);
        const isActiveTarget = ctx.getActive(ctx.opponentId)?.instanceId === targetId;

        ctx.removeStatus(targetId, BOMBE_ARGILE_STATUS_ID);

        if (isActiveTarget) {
          const damage = KATSU_ACTIVE_DAMAGE_BY_STACKS[stacks] ?? KATSU_ACTIVE_DAMAGE_BY_STACKS[BOMBE_ARGILE_MAX_STACKS]!;
          await ctx.dealDamage(targetId, damage);
          return;
        }

        await ctx.dealDamage(targetId, KATSU_BENCH_TARGET_DAMAGE);
        for (const ally of ctx.getAllOnBoard(ctx.opponentId)) {
          if (ally.instanceId !== targetId) await ctx.dealDamage(ally.instanceId, KATSU_BENCH_SPLASH_DAMAGE);
        }
      },
    },
  ],
};
