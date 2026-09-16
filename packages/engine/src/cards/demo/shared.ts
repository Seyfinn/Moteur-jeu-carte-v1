import type { EffectContext } from '../types.js';
import type { AttackDef } from '../types.js';
import type { CharacterInstance, DealDamageOptions } from '../../types.js';
import { getStatus, hasStatus } from '../../statuses.js';

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

/**
 * Convention maison : une attaque dont le texte dit « peut crit » crit à ce taux (contre
 * `BASE_CRITICAL_CHANCE_PERCENT` = 5 % pour n'importe quelle autre attaque). Voir CLAUDE.md,
 * « Attaque marquée "peut crit" ».
 */
export const MAY_CRIT_PERCENT = 33;

export interface HitActiveOptions {
  /**
   * Relève le taux de critique pour CE seul coup (la convention « peut crit » vaut
   * `MAY_CRIT_PERCENT`). Posé via le statut générique `critical` et son `data.percent`,
   * retiré aussitôt après -- sauf si le porteur en avait déjà un venu d'ailleurs, qu'il ne
   * faut ni écraser ni supprimer (sa base est déjà d'au moins ce taux).
   */
  critPercent?: number;
  /** Libellé du `critical` temporaire (en général le nom de l'attaque). */
  critLabel?: string;
  /** Transmis tel quel à `ctx.dealDamage`. */
  damageOptions?: DealDamageOptions;
}

/**
 * Frappe l'actif adverse pour l'ATK effectif de la source (`getEffectiveATK(baseATK)`).
 * Renvoie l'instanceId du personnage visé -- même si le coup a été esquivé ou absorbé --
 * ou `undefined` s'il n'y avait pas d'actif en face (rien n'est alors fait).
 *
 * C'est le squelette de toute attaque « X dégâts + un effet » : on frappe, puis on enchaîne
 * l'effet sur l'id renvoyé.
 */
export async function hitActive(
  ctx: EffectContext,
  baseATK: number,
  options: HitActiveOptions = {}
): Promise<string | undefined> {
  const target = ctx.getActive(ctx.opponentId);
  if (!target) return undefined;
  const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, baseATK);

  if (options.critPercent === undefined) {
    await ctx.dealDamage(target.instanceId, atk, options.damageOptions);
    return target.instanceId;
  }

  // Logique de « Frappe à la nuque » (Levi) : `critical` + `data.percent` posé juste avant
  // le coup, retiré juste après, en laissant tranquille un `critical` déjà porté.
  const self = ctx.getCharacter(ctx.sourceInstanceId);
  const alreadyCritical = hasStatus(self, 'critical');
  if (!alreadyCritical) {
    ctx.applyStatus(ctx.sourceInstanceId, {
      statusId: 'critical',
      label: options.critLabel ?? 'Peut crit',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { percent: options.critPercent },
    });
  }
  try {
    await ctx.dealDamage(target.instanceId, atk, options.damageOptions);
  } finally {
    if (!alreadyCritical) ctx.removeStatus(ctx.sourceInstanceId, 'critical');
  }
  return target.instanceId;
}

/**
 * « Cette attaque peut crit » : un `simpleAttack` dont le coup crit à `percent` % au lieu
 * des 5 % de base. Le texte imprimé reste `description`, mot pour mot.
 */
export function mayCritAttack(
  id: string,
  name: string,
  baseATK: number,
  description: string,
  percent: number = MAY_CRIT_PERCENT
): AttackDef {
  return {
    id,
    name,
    baseATK,
    description,
    async execute(ctx) {
      await hitActive(ctx, baseATK, { critPercent: percent, critLabel: name });
    },
  };
}

/**
 * Compteur persistant porté par un personnage (« après 3 kills… », « tous les 100 HP
 * perdus… ») : un statut SANS `remainingTurns` -- donc jamais retiré par
 * `tickStatusesAtTurnStart` -- dont `data.count` est la valeur. `0` si le personnage ne le
 * porte pas (ou n'est plus sur le plateau).
 */
export function readCounter(ctx: EffectContext, instanceId: string, statusId: string): number {
  let char: CharacterInstance;
  try {
    char = ctx.getCharacter(instanceId);
  } catch {
    return 0;
  }
  return Number(getStatus(char, statusId)?.data?.['count'] ?? 0);
}

export interface WriteCounterOptions {
  statusId: string;
  /** Libellé du statut (badge et journal, si le compteur n'est pas caché). */
  label: string;
  count: number;
  /**
   * `true` par défaut : un compteur est de la plomberie (ni badge, ni ligne de journal),
   * cf. CLAUDE.md « Statut de bookkeeping interne ». Passer `false` pour un compteur que
   * le joueur doit voir (la réserve de Mana Barrier de Blitzcrank).
   */
  hidden?: boolean;
}

/**
 * Écrit (ou remplace) un compteur persistant : il n'y a pas d'API « update » de statut,
 * donc remove + apply, exactement comme Guts / Hulk le font à la main. Sans jet d'esquive :
 * un compteur n'est pas une altération qu'on peut éviter, même posé sur un adversaire.
 */
export function writeCounter(ctx: EffectContext, instanceId: string, options: WriteCounterOptions): void {
  const { statusId, label, count, hidden = true } = options;
  ctx.removeStatus(instanceId, statusId);
  ctx.applyStatus(
    instanceId,
    {
      statusId,
      label,
      sourceCardInstanceId: ctx.sourceInstanceId,
      hidden,
      data: { count },
    },
    { skipEvasionRoll: true }
  );
}
