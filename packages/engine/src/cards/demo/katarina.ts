import type { CharacterCardDef } from '../types.js';
import { chancePercent } from '../../rng.js';

const BASE_ATK = 65;
const DISARM_CHANCE_PERCENT = 33;
/** Effet réel voulu : bloque l'unique prochaine attaque de la cible (1 tour). */
const DISARM_EFFECTIVE_TURNS = 1;
// Statut posé sur la CIBLE pendant le tour de Katarina -- le prochain tick pour la
// cible est donc son tour à elle, immédiatement après. remainingTurns doit donc valoir
// DISARM_EFFECTIVE_TURNS + 1 pour survivre à ce tick et bloquer réellement son tour ;
// avec seulement DISARM_EFFECTIVE_TURNS le statut serait retiré avant même qu'elle
// n'agisse (voir statuses.ts, tickStatusesAtTurnStart : le tick décrémente PUIS
// filtre, avant que le joueur actif ne puisse agir ce tour-là).
const DISARM_REMAINING_TURNS = DISARM_EFFECTIVE_TURNS + 1;

// Partagé entre execute() et endsTurn() de "Shunpo" -- voir CLAUDE.md, pattern
// "peut agir de nouveau ce tour si condition remplie pendant l'attaque" (Voracity).
let killedThisAttack = false;

export const katarina: CharacterCardDef = {
  type: 'character',
  id: 'katarina',
  name: 'Katarina',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'shunpo',
      name: 'Shunpo',
      baseATK: BASE_ATK,
      description: `Inflige ${BASE_ATK} dégâts à l'actif adverse. Si des dégâts passent réellement (pas d'esquive), ${DISARM_CHANCE_PERCENT}% de chance de désarmer la cible pendant ${DISARM_EFFECTIVE_TURNS} tour.`,
      endsTurn() {
        return !killedThisAttack;
      },
      async execute(ctx) {
        killedThisAttack = false;
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        if (ctx.isKO(target.instanceId)) {
          killedThisAttack = true; // Voracity : Katarina peut immédiatement attaquer de nouveau
          return;
        }

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && chancePercent(ctx.state.rng, DISARM_CHANCE_PERCENT)) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'disarmed',
            label: 'Désarmé (Shunpo)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: DISARM_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'voracity',
      name: 'Voracity',
      kind: 'passive',
      description: 'Si Katarina tue un personnage ennemi avec Shunpo, elle peut immédiatement attaquer de nouveau ce tour.',
      // Purement descriptive : la logique vit dans l'AttackDef de Shunpo ci-dessus
      // (flag en closure partagé entre execute/endsTurn), pas via un trigger d'event --
      // onCharacterKO ne donne pas assez d'info pour savoir qui a tué la cible.
      async execute() {},
    },
  ],
};
