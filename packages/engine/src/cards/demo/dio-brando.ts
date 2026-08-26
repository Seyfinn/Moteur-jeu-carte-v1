import type { CharacterCardDef } from '../types.js';
import { hasStatus } from '../../statuses.js';

const CHAIR_VAMPIRIQUE_ATK = 50;
const SILENCE_CHANCE_PERCENT = 50;
const SILENCE_EFFECTIVE_TURNS = 1;
/** Posé sur l'ennemi pendant le tour de Dio -> +1 (cf. CLAUDE.md, le piège des durées). */
const SILENCE_REMAINING_TURNS = SILENCE_EFFECTIVE_TURNS + 1;

/** "Chair Vampirique" (passive) : part des dégâts réellement portés que Dio se rend en PV. */
const LIFESTEAL_PERCENT = 30;

/**
 * "Za Warudo !" : le malus de -50 % qui pèse sur TOUTE l'équipe **pendant le tour arrêté**,
 * c'est-à-dire le second tour, pas celui où la capacité est lancée. Statut générique
 * `atk-multiplier` du moteur, donc aucune logique à écrire ici.
 *
 * Le décalage d'un tour passe par un `onExpire` : le statut posé maintenant est un simple
 * marqueur d'attente qui expire au tout début du tour bonus et pose le malus à ce
 * moment-là. Comme `onExpire` est appliqué APRÈS la passe de décompte, le malus n'est pas
 * décompté à son arrivée : il vit exactement le tour bonus et disparaît au tick d'ouverture
 * du tour suivant de Dio. C'est ce qui garantit le « premier tour à 100 %, second tour à
 * 50 % » -- avec un `atk-multiplier` posé directement, la fin du tour de lancement était
 * déjà pénalisée.
 *
 * `ticksOnBench` des deux côtés parce que cinq des six porteurs sont au banc, où les durées
 * seraient autrement suspendues (le marqueur n'expirerait jamais).
 */
const WEAKENED_PENDING_STATUS_ID = 'dio-za-warudo-imminent';
const WEAKENED_MULTIPLIER = 0.5;

/**
 * Le temps arrêté lui-même : tant que ce marqueur est sur Dio, le modifier `canSwitchAny`
 * plus bas refuse TOUS les switchs, des deux camps et switchs forcés compris (c'est la
 * seule portée qui ferme aussi un `forceSwitch` de carte, cf. CLAUDE.md). Même décalage
 * d'un tour que le malus : le tour de lancement reste un tour normal.
 *
 * Porté par Dio seul plutôt que par les douze personnages : les statuts de l'adversaire ne
 * tiquent que pendant SES tours, or il n'en joue aucun entre les deux tours de Dio -- un
 * marqueur posé sur lui expirerait pendant son tour normal d'après, où il n'a rien à faire.
 */
const TIME_STOP_STATUS_ID = 'dio-temps-arrete';
const TIME_STOP_PENDING_STATUS_ID = 'dio-temps-arrete-imminent';

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
        // le même joueur au lieu de passer la main, l'adversaire saute donc son tour) : une
        // carte ne peut pas décider de la rotation des tours toute seule.
        ctx.grantExtraTurn();

        // « les dégâts de Dio sont réduits de 50 % » : toute son équipe, pas seulement lui,
        // et seulement pendant le tour arrêté (le second). D'où le marqueur d'attente.
        for (const ally of ctx.getAllOnBoard(ctx.ownerId)) {
          ctx.applyStatus(ally.instanceId, {
            statusId: WEAKENED_PENDING_STATUS_ID,
            label: 'Za Warudo ! (imminent)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: 1,
            ticksOnBench: true,
            hidden: true, // simple délai interne ; c'est le malus lui-même qui s'affiche
            onExpire: {
              statusId: 'atk-multiplier',
              label: 'Za Warudo ! (dégâts réduits)',
              sourcePlayerId: ctx.ownerId,
              sourceCardInstanceId: ctx.sourceInstanceId,
              remainingTurns: 1,
              ticksOnBench: true,
              data: { multiplier: WEAKENED_MULTIPLIER },
            },
          });
        }

        // Pendant le temps arrêté, plus personne ne bouge : aucun switch, dans aucun camp.
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: TIME_STOP_PENDING_STATUS_ID,
          label: 'Za Warudo ! (imminent)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: 1,
          ticksOnBench: true,
          hidden: true,
          onExpire: {
            statusId: TIME_STOP_STATUS_ID,
            label: 'Za Warudo ! (temps arrêté)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: 1,
            ticksOnBench: true,
          },
        });
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
  modifiers: [
    {
      // "Za Warudo !" : pendant le tour arrêté, aucun switch n'est possible -- ni l'action
      // de switch d'un joueur, ni un `forceSwitch` de carte. `canSwitchAny` est la seule
      // portée évaluée dans `zones.switchActive`, l'unique point de passage commun.
      // Le remplacement d'un personnage KO, lui, n'est pas un switch et reste ouvert :
      // sinon un camp pourrait se retrouver sans actif et la partie se bloquerait.
      query: 'canSwitchAny',
      isActive(ctx) {
        const self = ctx.state.players[ctx.sourceOwnerId].characters[ctx.sourceInstanceId];
        return !!self && hasStatus(self, TIME_STOP_STATUS_ID);
      },
      vote() {
        return { allow: false, source: 'dio-za-warudo', reason: 'le temps est arrêté (Za Warudo !)' };
      },
    },
  ],
};
