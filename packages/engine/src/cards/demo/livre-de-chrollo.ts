import type { AttackDef, EffectContext, TerrainCardDef } from '../types.js';
import type { PlayerId } from '../../types.js';
import { getCharacterCard, listCards } from '../registry.js';
import { randomInt } from '../../rng.js';

const DURATION_TURNS = 3;
/**
 * Le prêt tient exactement le tour de son bénéficiaire. Le statut est posé pendant
 * `onTurnStart`, qui passe AVANT `tickStatusesAtTurnStart` (turn.ts) : d'où le `+1` des
 * statuts bloquants, sans quoi il serait décompté et retiré avant que le joueur ne joue.
 * `ticksOnBench` parce que le prêt suit le personnage même s'il finit au banc dans la
 * foulée -- une durée gelée là-bas ressortirait intacte des tours plus tard.
 */
const LOAN_EFFECTIVE_TURNS = 1;
const LOAN_REMAINING_TURNS = LOAN_EFFECTIVE_TURNS + 1;

interface Offer {
  cardId: string;
  attackId: string;
}

/**
 * L'attaque proposée ce tour-ci, tirée une seule fois par manche et rangée dans le `data`
 * libre du terrain : « La même attaque est proposée aux deux joueurs pendant le tour ».
 * `state.turnNumber` n'avance qu'au retour du joueur qui ouvre la manche (turn.ts), il
 * identifie donc exactement le tour de jeu que les deux camps partagent.
 */
function offerOfTheTurn(ctx: EffectContext): Offer | undefined {
  const terrain = ctx.getTerrain(ctx.sourceInstanceId);
  const data = terrain.data;
  const cardId = data?.['cardId'];
  const attackId = data?.['attackId'];
  if (data?.['turnNumber'] === ctx.state.turnNumber && typeof cardId === 'string' && typeof attackId === 'string') {
    return { cardId, attackId };
  }

  const pool: Offer[] = [];
  for (const card of listCards()) {
    if (card.type !== 'character') continue;
    for (const attack of card.attacks) pool.push({ cardId: card.id, attackId: attack.id });
  }
  if (pool.length === 0) return undefined;

  const drawn = pool[randomInt(ctx.state.rng, pool.length)]!;
  terrain.data = { ...data, turnNumber: ctx.state.turnNumber, cardId: drawn.cardId, attackId: drawn.attackId };
  return drawn;
}

function attackOf(offer: Offer): AttackDef | undefined {
  try {
    return getCharacterCard(offer.cardId).attacks.find((a) => a.id === offer.attackId);
  } catch {
    return undefined;
  }
}

export const livreDeChrollo: TerrainCardDef = {
  type: 'terrain',
  id: 'livre-de-chrollo',
  name: 'Livre de Chrollo',
  description: `Chrollo prête son livre aux joueurs. Chaque tour, au début du tour : Une attaque au hasard parmi l'entièreté des attaques du jeu, est proposé aux joueurs.
Le joueur peut décider de l'accepter le livre de Chrollo et prendre ce qui est offert. 
Si il accepte, il ne pourra que utiliser cette attaque pendant ce tour.
La même attaque est proposé aux deux joueurs pendant le tour.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'livre-de-chrollo-pret',
      name: 'Le prêt',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description:
        "L'attaque empruntée est portée par le personnage actif du moment, avec son propre ATK effectif, et repart avec lui s'il quitte le poste actif.",
      // `onTerrainPlayed` en plus de `onTurnStart` : le tour du poseur a commencé avant
      // que le livre ne soit sur la table, il n'aurait donc rien eu à emprunter avant le
      // tour de l'adversaire. La pose vaut ouverture du livre pour son propre tour.
      trigger: ['onTurnStart', 'onTerrainPlayed'],
      condition(ctx) {
        if (ctx.event?.name === 'onTerrainPlayed') {
          // Uniquement CE terrain-là : l'event part pour n'importe quelle pose, y compris
          // celle de l'adversaire (cf. CLAUDE.md).
          return ctx.event.data['terrainInstanceId'] === ctx.sourceInstanceId;
        }
        const playerId = ctx.event?.playerId;
        if (!playerId) return false;
        // Le décompte du terrain tombe juste après ce `onTurnStart` et seulement pendant
        // les tours de son possesseur (zones.tickTerrainAtTurnStart) : lui prêter une
        // attaque pour un terrain qui disparaît dans la seconde n'aurait aucun sens.
        // L'adversaire, lui, a toujours un tour complet devant lui.
        if (playerId !== ctx.ownerId) return true;
        const remaining = ctx.getTerrain(ctx.sourceInstanceId).remainingTurns;
        return remaining === undefined || remaining > 1;
      },
      async execute(ctx) {
        // À la pose, l'event nomme bien le poseur : c'est lui qui reçoit l'offre.
        const playerId = ctx.event?.playerId as PlayerId | undefined;
        if (!playerId) return;
        const active = ctx.getActive(playerId);
        if (!active) return;

        const offer = offerOfTheTurn(ctx);
        if (!offer) return;
        const attack = attackOf(offer);
        if (!attack) return;
        const lender = getCharacterCard(offer.cardId).name;

        // « Refuser » en tête : un prompt laissé sans réponse est résolu par la première
        // option (defaultChoiceAnswer), et accepter ferme toutes les attaques du joueur --
        // ce n'est pas un cadeau qu'on peut lui imposer par son silence.
        const answer = await ctx.chooseOptionFor(
          playerId,
          `Livre de Chrollo — ${attack.name} (${lender}, ${attack.baseATK} ATK) : ${attack.description}`,
          [
            { key: 'refuser', label: 'Refermer le livre' },
            { key: 'accepter', label: `Emprunter ${attack.name} (seule attaque possible ce tour)` },
          ]
        );
        if (answer !== 'accepter') return;

        // 'borrowed-attack' : statut générique du moteur. Il ajoute l'attaque empruntée à
        // celles du porteur (queries.ts::attacksAvailableTo) ET ferme toutes les siennes
        // (queries.ts::canAttack) -- « il ne pourra que utiliser cette attaque ».
        ctx.applyStatus(
          active.instanceId,
          {
            statusId: 'borrowed-attack',
            label: `Livre de Chrollo : ${attack.name}`,
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            // Posé à la pose du terrain, la passe de décompte du tour est déjà passée :
            // le `+1` ferait durer le prêt jusqu'au tour SUIVANT du même joueur.
            remainingTurns: ctx.event?.name === 'onTerrainPlayed' ? LOAN_EFFECTIVE_TURNS : LOAN_REMAINING_TURNS,
            ticksOnBench: true,
            data: { cardId: offer.cardId, attackId: offer.attackId },
          },
          { skipEvasionRoll: true }
        );
      },
    },
  ],
};
