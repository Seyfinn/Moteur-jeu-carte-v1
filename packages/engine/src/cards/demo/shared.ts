import type { EffectContext } from '../types.js';
import type { AttackDef } from '../types.js';

/**
 * Une entrée (attaque ou capacité) empruntée à une autre carte s'exécute avec le VOLEUR
 * pour source -- le Spell Thief de Zoé, l'Actif volé et la Dague de Ben de Chrollo. Sa
 * propre `condition` doit donc être jugée sur le voleur, ici et maintenant : un compteur
 * qui vit chez la victime (le cycle d'Escanor, les sacrifices de Makima, les matériaux
 * d'Ornn) ne le suit pas, et relancer l'entrée quand même donnait soit un coup gratuit
 * hors-cycle, soit une capacité dépensée pour rien.
 *
 * ⚠️ Le garde de ré-entrance n'est pas décoratif : rien n'interdit aux deux camps
 * d'aligner chacun sa voleuse, et « ta capacité serait-elle jouable ? » posé en boucle
 * d'une Zoé à l'autre fait exploser la pile. Le drapeau vit au niveau du module, ce qui
 * est sans danger ICI et seulement ici (cf. l'interdiction générale dans CLAUDE.md) :
 * une `condition` est SYNCHRONE par signature, donc aucune autre partie hébergée par le
 * même serveur ne peut s'intercaler entre l'entrée et le `finally`.
 */
const conditionsBeingEvaluated = new Set<object>();

export function isRelaunchable(
  entry: { condition?(ctx: EffectContext): boolean },
  ctx: EffectContext
): boolean {
  if (!entry.condition) return true;
  if (conditionsBeingEvaluated.has(entry)) return false; // boucle détectée : on refuse
  conditionsBeingEvaluated.add(entry);
  try {
    return entry.condition(ctx);
  } finally {
    conditionsBeingEvaluated.delete(entry);
  }
}

/** Straightforward "hit the opponent's active character for X" attack. */
export function simpleAttack(id: string, name: string, baseATK: number, description: string): AttackDef {
  return {
    id,
    name,
    baseATK,
    description,
    async execute(ctx) {
      const target = ctx.getActive(ctx.opponentId);
      if (!target) return;
      const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, baseATK);
      await ctx.dealDamage(target.instanceId, atk);
    },
  };
}
