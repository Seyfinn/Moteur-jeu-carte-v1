import type { CharacterCardDef } from '../types.js';

const CHAIR_VAMPIRIQUE_ATK = 50;
const SILENCE_CHANCE_PERCENT = 50;
const SILENCE_EFFECTIVE_TURNS = 1;
/** Posé sur l'ennemi pendant le tour de Dio -> +1 (cf. CLAUDE.md, le piège des durées). */
const SILENCE_REMAINING_TURNS = SILENCE_EFFECTIVE_TURNS + 1;

/** "Chair Vampirique" (passive) : part des dégâts réellement portés que Dio se rend en PV. */
const LIFESTEAL_PERCENT = 30;

/**
 * "Za Warudo !" : le malus de -50 % qui pèse sur TOUTE l'équipe pendant le tour bonus.
 * Statut générique `atk-multiplier` du moteur, donc aucune logique à écrire ici.
 *
 * Durée : posé pendant le tour N, il doit être encore là pendant le tour bonus (qui est le
 * `startTurn` suivant du même joueur) et disparaître ensuite. `remainingTurns: 2` fait
 * exactement ça -- le tick d'ouverture du tour bonus le descend à 1, celui du tour d'après
 * le retire. `ticksOnBench` parce que cinq des six porteurs sont au banc, où les durées
 * sont autrement suspendues.
 */
const WEAKENED_REMAINING_TURNS = 2;
const WEAKENED_MULTIPLIER = 0.5;

export const dioBrando: CharacterCardDef = {
  type: 'character',
  id: 'dio-brando',
  name: 'Dio Brando',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'chair-vampirique',
      name: 'Chair Vampirique',
      baseATK: CHAIR_VAMPIRIQUE_ATK,
      description: "50% d'appliquer Silence Passif 1 tour",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CHAIR_VAMPIRIQUE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        if (ctx.rollChance(SILENCE_CHANCE_PERCENT, 'Silence Passif', { characterInstanceId: target.instanceId })) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'silence-passive',
            label: 'Silence Passif (Chair Vampirique)',
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
      id: 'za-warudo',
      name: 'Za Warudo !',
      kind: 'active',
      description:
        "Tu rejoues un second tour complet d'affilée une fois ce tour terminé pendant le tour arrêté, les dégâts de Dio sont réduit de 50% Utilisable 1x",
      usesPerGame: 1,
      async execute(ctx) {
        // Le tour bonus lui-même est un mécanisme du moteur (`endTurn` rouvre un tour pour
        // le même joueur au lieu de passer la main) : une carte ne peut pas décider de la
        // rotation des tours toute seule.
        ctx.grantExtraTurn();

        // « les dégâts de Dio sont réduits de 50 % » : toute son équipe, pas seulement lui.
        for (const ally of ctx.getAllOnBoard(ctx.ownerId)) {
          ctx.applyStatus(ally.instanceId, {
            statusId: 'atk-multiplier',
            label: 'Za Warudo ! (dégâts réduits)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: WEAKENED_REMAINING_TURNS,
            ticksOnBench: true,
            data: { multiplier: WEAKENED_MULTIPLIER },
          });
        }
      },
    },
    {
      id: 'chair-vampirique-passive',
      name: 'Chair Vampirique',
      kind: 'passive',
      description: "Dio récupère en PV 30% des défâts qu'il inflige avec ses attaques.",
      trigger: 'afterDamage',
      // Doit compter même si Dio frappe depuis le banc (attaque prêtée, lien Jacob & Essau).
      usableFromBench: true,
      // Plusieurs instances de dégâts peuvent partir dans le même tour (attaque supplémentaire,
      // partenaire lié) : chacune doit rendre ses PV.
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.data['sourceInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const data = ctx.event!.data;
        // Le bouclier encaissé compte comme des dégâts réellement infligés : Dio se nourrit
        // du coup porté, pas de ce qui a fini par passer les protections.
        const dealt = Number(data['amount'] ?? 0) + Number(data['shieldAbsorbed'] ?? 0);
        if (dealt <= 0) return;
        const healed = Math.round(dealt * (LIFESTEAL_PERCENT / 100));
        if (healed <= 0) return;
        ctx.heal(ctx.sourceInstanceId, healed);
      },
    },
  ],
};
