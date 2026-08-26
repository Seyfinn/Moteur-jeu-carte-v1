import type { CharacterCardDef } from '../types.js';
import { hasDeathWard } from '../../statuses.js';
import { cardName } from '../../names.js';
import { canTargetBench } from '../../queries.js';

const PURGATOIRE_THRESHOLD_PERCENT = 10;

const CLOU_STATUS_ID = 'locke-clou';
const CLOU_THRESHOLD = 3;
const EXPLOSION_BASE_DAMAGE = 100;
const EXPLOSION_PERCENT_OF_TARGET_MAX_HP = 50;

const SILENCE_CHANCE_PERCENT = 65;
const SILENCE_EFFECTIVE_TURNS = 1;
// Ciblé sur l'ennemi pendant le tour de Locke -> +1 (même correction que le Stun de
// Gojo / le Poison de Muzan : tickStatusesAtTurnStart décrémente PUIS filtre, avant que
// le joueur actif ne puisse agir ce tour-là -- voir CLAUDE.md, "Durées de statuts").
const SILENCE_REMAINING_TURNS = SILENCE_EFFECTIVE_TURNS + 1;

export const locke: CharacterCardDef = {
  type: 'character',
  id: 'locke',
  name: 'Locke',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'marteau',
      name: 'Marteau',
      baseATK: 0,
      description:
        "Locke enfonce un clou sur n'importe quel ennemi, même sur le banc. Cette attaque " +
        "inflige a 65% de chance d'infliger silence ultime si Locke attaque l'ennemi actif.",
      async execute(ctx) {
        // L'actif reste toujours ciblable ; le banc, seulement s'il est atteignable
        // (Bouclier Ultime le protège, Arène l'isole).
        const activeEnemy = ctx.getActive(ctx.opponentId);
        const enemies = ctx.getAllOnBoard(ctx.opponentId).filter(
          (c) =>
            c.instanceId === activeEnemy?.instanceId ||
            canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow
        );
        if (enemies.length === 0) return;
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Marteau : choisissez la cible à clouer',
          options: enemies.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;

        const targetChar = ctx.getCharacter(targetId);
        const existing = targetChar.statuses.find((s) => s.statusId === CLOU_STATUS_ID);
        const newCount = Number(existing?.data?.['count'] ?? 0) + 1;
        const triggersExplosion = newCount >= CLOU_THRESHOLD;

        // Un seul jet d'esquive pour toute l'attaque (le clou ET la chance de Silence
        // Ultime qui en découle) : Marteau ne fait pas de dégâts, donc il n'y a pas de
        // "coup" séparé sur lequel l'esquive du clou pourrait porter indépendamment de
        // celle du silence -- contrairement à Zoé/Chopper/Sion où le dégât et l'effet
        // sur coup sont deux jets distincts. Fait via rollEvasion (pas dealDamage/
        // applyStatus) pour décider AVANT de toucher au compteur de clous : sinon un
        // remove+reapply raté à l'esquive effacerait les clous déjà plantés.
        //
        // Exception : "Cloué" est INESQUIVABLE. Le coup qui plante le 3e clou ne roule
        // donc aucune esquive (sans quoi le clou ne serait pas planté et l'explosion
        // n'aurait jamais lieu), et l'explosion elle-même part en `skipEvasionRoll` --
        // sinon la cible aurait deux occasions d'échapper au même effet.
        if (!triggersExplosion && ctx.rollEvasion(targetId)) return;

        if (existing) ctx.removeStatus(targetId, CLOU_STATUS_ID);

        if (triggersExplosion) {
          // Cloué : le 3e clou fait exploser la cible et le compteur repart de zéro (pas
          // de statut à réappliquer). L'explosion reste une vraie instance de dégâts
          // (bouclier, réductions, critique) créditée à Locke -- seule l'esquive est
          // court-circuitée.
          ctx.log(`Cloué : les clous de ${cardName(targetChar.cardId)} explosent`, {
            characterInstanceId: targetId,
          });
          const explosionAmount =
            EXPLOSION_BASE_DAMAGE + Math.round(targetChar.currentMaxHP * (EXPLOSION_PERCENT_OF_TARGET_MAX_HP / 100));
          await ctx.dealDamage(targetId, explosionAmount, { skipEvasionRoll: true });
        } else {
          ctx.applyStatus(
            targetId,
            {
              statusId: CLOU_STATUS_ID,
              label: `Clou (${newCount}/${CLOU_THRESHOLD})`,
              sourcePlayerId: ctx.ownerId,
              sourceCardInstanceId: ctx.sourceInstanceId,
              data: { count: newCount },
            },
            { skipEvasionRoll: true } // déjà résolu ci-dessus via rollEvasion
          );
        }

        const opponentActive = ctx.getActive(ctx.opponentId);
        const isActiveTarget = opponentActive?.instanceId === targetId;
        if (
          isActiveTarget &&
          ctx.rollChance(SILENCE_CHANCE_PERCENT, 'Silence Ultime', { characterInstanceId: targetId })
        ) {
          ctx.applyStatus(
            targetId,
            {
              statusId: 'silence-ultimate',
              label: 'Silence Ultime (Marteau)',
              sourcePlayerId: ctx.ownerId,
              sourceCardInstanceId: ctx.sourceInstanceId,
              remainingTurns: SILENCE_REMAINING_TURNS,
            },
            { skipEvasionRoll: true } // même jet que le clou : l'attaque a déjà touché
          );
        }
      },
    },
  ],
  abilities: [
    {
      id: 'purgatoire',
      name: 'Purgatoire',
      kind: 'passive',
      description: `Si l'ennemi au poste actif est à ${PURGATOIRE_THRESHOLD_PERCENT}% de ses hp max ou moins, l'execute immédiatement.`,
      // "immédiatement" veut dire dès que l'actif adverse passe sous le seuil suite à une
      // instance de dégâts, quelle qu'en soit la cause (Marteau, un allié de Locke, un tic
      // de poison/brûlure/saignement -- tout passe par afterDamage, voir match.ts).
      // usableFromBench: false (défaut) : canUseAbility exige donc que LOCKE lui-même
      // soit le personnage actif pour que Purgatoire se déclenche -- conforme au choix
      // "l'aura ne tourne que quand Locke est sorti".
      // Angles morts assumés (un AbilityDef n'a qu'un seul `trigger` -- en ajouter un
      // second aurait dupliqué "Purgatoire" en deux blocs identiques dans le détail de
      // carte, voir cardDetails.tsx) :
      //  - une perte de HP max pure (valeur lock) qui ferait passer sous le seuil sans
      //    dégâts ne déclenche pas afterDamage ;
      //  - un personnage du banc déjà sous le seuil (ex: survivant d'une AoE) qui devient
      //    l'actif adverse par switch/remplacement sans subir de nouveaux dégâts à ce
      //    moment-là n'est pas exécuté tant qu'il n'encaisse pas un nouveau coup.
      // Dans les deux cas, Purgatoire reste "en retard d'un événement" plutôt qu'omniscient.
      trigger: 'afterDamage',
      usesPerTurn: Infinity,
      condition(ctx) {
        const targetId = ctx.event?.data['targetInstanceId'] as string | undefined;
        if (!targetId) return false;
        if (ctx.isKO(targetId)) return false; // déjà mort via les dégâts classiques
        const opponentActive = ctx.getActive(ctx.opponentId);
        if (!opponentActive || opponentActive.instanceId !== targetId) return false;
        const target = ctx.getCharacter(targetId);
        if (hasDeathWard(target)) return false;
        const remainingHP = target.currentMaxHP - target.damage;
        return remainingHP > 0 && remainingHP <= target.currentMaxHP * (PURGATOIRE_THRESHOLD_PERCENT / 100);
      },
      async execute(ctx) {
        const targetId = ctx.event!.data['targetInstanceId'] as string;
        ctx.log(`Purgatoire : achève ${cardName(ctx.getCharacter(targetId).cardId)}`, {
          characterInstanceId: targetId,
        });
        await ctx.koCharacter(targetId);
      },
    },
    {
      id: 'cloue',
      name: 'Cloué',
      kind: 'passive',
      description: 'Lorsqu\'un ennemi a 3 clous sur lui, Locke fait exploser les clous infligeant 100 dégâts + 50% hp max.',
      // Purement descriptive : la logique vit dans Marteau ci-dessus (c'est le moment où
      // le 3e clou est planté qui décide de l'explosion, pas un event séparé).
      async execute() {},
    },
  ],
};
