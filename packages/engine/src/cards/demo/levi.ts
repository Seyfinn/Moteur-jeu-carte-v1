import type { CharacterCardDef, EffectContext } from '../types.js';
import { otherPlayer, type CharacterInstance } from '../../types.js';
import { getCurrentHP } from '../../hp.js';
import { canTargetBench } from '../../queries.js';
import { hasStatus } from '../../statuses.js';

const TAILLADE_ATK = 90;
const NUQUE_ATK = 60;
const TRAQUE_HP_THRESHOLD = 60;
/** Convention maison : une attaque marquée « peut crit » crit à ce taux. */
const CRIT_PERCENT = 33;

/**
 * Les cibles que Levi peut frapper : l'actif adverse toujours, plus les personnages du banc
 * adverse sous le seuil de "Traque". Le seuil est relu à chaque attaque, jamais mémorisé :
 * un personnage soigné au-dessus de 60 PV redevient hors de portée.
 */
function reachableTargets(ctx: EffectContext): CharacterInstance[] {
  const targets: CharacterInstance[] = [];
  const active = ctx.getActive(ctx.opponentId);
  if (active) targets.push(active);
  for (const benched of ctx.getBench(ctx.opponentId)) {
    if (getCurrentHP(benched) >= TRAQUE_HP_THRESHOLD) continue;
    // Le banc reste soumis aux protections générales (Bouclier Ultime, Arène) : "Traque"
    // lève la restriction de ciblage par défaut, pas celle qu'une carte adverse impose.
    if (!canTargetBench(ctx.state, ctx.sourceInstanceId, benched.instanceId, true).allow) continue;
    targets.push(benched);
  }
  return targets;
}

/** Fait choisir la cible quand "Traque" en ouvre plusieurs ; sinon frappe l'actif sans rien demander. */
async function pickTarget(ctx: EffectContext, attackName: string): Promise<string | undefined> {
  const targets = reachableTargets(ctx);
  if (targets.length === 0) return undefined;
  if (targets.length === 1) return targets[0]!.instanceId;
  const [chosen] = await ctx.choose({
    kind: 'select-characters',
    prompt: `${attackName} : choisissez la cible`,
    options: targets.map((c) => c.instanceId),
    min: 1,
    max: 1,
  });
  return chosen;
}

export const levi: CharacterCardDef = {
  type: 'character',
  id: 'levi',
  name: 'Levi',
  baseMaxHP: 220,
  attacks: [
    {
      id: 'taillade-eclair',
      name: 'Taillade éclair',
      baseATK: TAILLADE_ATK,
      description: '',
      async execute(ctx) {
        const targetId = await pickTarget(ctx, 'Taillade éclair');
        if (!targetId) return;
        await ctx.dealDamage(targetId, ctx.getEffectiveATK(ctx.sourceInstanceId, TAILLADE_ATK));
      },
    },
    {
      id: 'frappe-a-la-nuque',
      name: 'Frappe à la nuque',
      baseATK: NUQUE_ATK,
      description: 'Cette attaque peut crit',
      async execute(ctx) {
        const targetId = await pickTarget(ctx, 'Frappe à la nuque');
        if (!targetId) return;

        // « Peut crit » = taux relevé pour ce seul coup, via le statut générique 'critical'
        // et son `data.percent` (même primitive que Godspeed de Killua). Posé puis retiré
        // autour de l'attaque -- sauf si Levi portait déjà un 'critical' venu d'ailleurs,
        // qu'il ne faut ni écraser ni supprimer (sa base est déjà d'au moins ce taux).
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const alreadyCritical = hasStatus(self, 'critical');
        if (!alreadyCritical) {
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: 'critical',
            label: 'Frappe à la nuque',
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { percent: CRIT_PERCENT },
          });
        }
        try {
          await ctx.dealDamage(targetId, ctx.getEffectiveATK(ctx.sourceInstanceId, NUQUE_ATK));
        } finally {
          if (!alreadyCritical) ctx.removeStatus(ctx.sourceInstanceId, 'critical');
        }
      },
    },
  ],
  abilities: [
    {
      id: 'traque',
      name: 'Traque',
      kind: 'passive',
      description:
        'Si au moins un personnage sur le banc adverse a moins de 60 HP actuels, les attaques de Levi peuvent cibler ce personnage du banc, ignorant la restriction de ciblage par défaut.',
      // Purement descriptive : la portée est appliquée par les deux attaques ci-dessus, qui
      // proposent le banc éligible en plus de l'actif.
      async execute() {},
    },
  ],
  modifiers: [
    {
      // Le pendant déclaratif de "Traque" : c'est la carte de Levi qui s'autorise le banc,
      // pour que toute autre requête de ciblage le sache aussi.
      query: 'canTargetBench',
      vote(ctx) {
        if (ctx.query['sourceInstanceId'] !== ctx.sourceInstanceId) return undefined;
        const enemy = ctx.state.players[otherPlayer(ctx.sourceOwnerId)];
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = enemy.characters[targetInstanceId];
        if (!target || !enemy.benchCharacterInstanceIds.includes(targetInstanceId)) return undefined;
        if (getCurrentHP(target) >= TRAQUE_HP_THRESHOLD) return undefined;
        return { allow: true, source: 'levi-traque' };
      },
    },
  ],
};
