import type { ModifierEvalContext, TerrainCardDef } from '../types.js';
import type { PlayerId } from '../../types.js';

const SOURCE = 'terrain:arene';
const DURATION_TURNS = 2;
/** « les dégâts infligés entre les deux personnages actifs sont augmentés de 30 % ». */
const ACTIVE_DUEL_DAMAGE_BONUS_PERCENT = 30;

/** Vrai si cette instance est sur le banc de l'un ou l'autre camp -- Arène isole les deux. */
function isOnAnyBench(ctx: ModifierEvalContext, instanceId: string): boolean {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (ctx.state.players[playerId].benchCharacterInstanceIds.includes(instanceId)) return true;
  }
  return false;
}

/** Vrai si cette instance tient le poste actif de l'un ou l'autre camp. */
function isAnyActive(ctx: ModifierEvalContext, instanceId: string | undefined): boolean {
  if (!instanceId) return false;
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (ctx.state.players[playerId].activeCharacterInstanceId === instanceId) return true;
  }
  return false;
}

export const arene: TerrainCardDef = {
  type: 'terrain',
  id: 'arene',
  name: 'Arène',
  description:
    'Isole totalement le poste actif des deux joueurs. Les switchs, les soins venant du banc et toutes les compétences (Actifs/Passifs) ciblant ou venant du banc sont totalement bloqués. De plus, les dégâts infligés entre les deux personnages actifs sont augmentés de 30 %.',
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      // « Les switchs [...] sont totalement bloqués », pour les DEUX camps. Posé sur
      // `canSwitchAny`, donc les switchs forcés par une carte tombent aussi.
      // ⚠️ Le remplacement d'un personnage KO n'est pas un switch et passe toujours
      // (zones.koCharacter) : sans cette porte, un camp dont l'actif meurt sous Arène
      // n'aurait plus d'actif et la partie se bloquerait.
      query: 'canSwitchAny',
      vote() {
        return { allow: false, source: SOURCE, reason: 'Arène (poste actif isolé)' };
      },
    },
    {
      // « toutes les compétences (Actifs/Passifs) [...] venant du banc » : plus personne
      // n'agit depuis le banc, quel que soit son `usableFromBench`.
      query: 'canUseAbility',
      vote(ctx) {
        if (!isOnAnyBench(ctx, ctx.query['characterInstanceId'] as string)) return undefined;
        return { allow: false, source: SOURCE, reason: 'Arène (banc isolé)' };
      },
    },
    {
      // « ... ciblant [le banc] » : plus aucune carte ne peut désigner un personnage de
      // banc, dans un camp comme dans l'autre.
      query: 'canTargetBench',
      vote(ctx) {
        if (!isOnAnyBench(ctx, ctx.query['targetInstanceId'] as string)) return undefined;
        return { allow: false, source: SOURCE, reason: 'Arène (banc isolé)' };
      },
    },
    {
      // « les soins venant du banc [...] bloqués » : lu comme l'isolement complet du banc,
      // qui ne reçoit plus un seul point de vie. Le moteur ne transmet pas la source d'un
      // soin, seulement sa cible -- c'est donc bien la cible qui est verrouillée ici.
      query: 'getIncomingHealAmount',
      transform(ctx, current) {
        return isOnAnyBench(ctx, ctx.query['targetInstanceId'] as string) ? 0 : current;
      },
    },
    {
      // « les dégâts infligés entre les deux personnages actifs sont augmentés de 30 % » :
      // dans les deux sens, attaques comme capacités. Il faut un actif des deux côtés de
      // l'échange -- un coup porté au banc, ou venant du banc, n'est pas ce duel-là.
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        const targetIsActive = isAnyActive(ctx, ctx.query['targetInstanceId'] as string);
        const attackerIsActive = isAnyActive(ctx, ctx.query['attackerInstanceId'] as string | undefined);
        if (!targetIsActive || !attackerIsActive) return current;
        return Math.round((current as number) * (1 + ACTIVE_DUEL_DAMAGE_BONUS_PERCENT / 100));
      },
    },
  ],
};
