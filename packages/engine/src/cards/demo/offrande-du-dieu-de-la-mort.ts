import type { ObjectCardDef } from '../types.js';
import type { ChoiceOption, PlayerId } from '../../types.js';
import type { RngState } from '../../rng.js';
import { listCards } from '../registry.js';
import { randomInt } from '../../rng.js';

const OWNER_CHOICE_COUNT = 6;
const OPPONENT_CHOICE_COUNT = 2;

/**
 * Tire `count` cartes objet DISTINCTES parmi toutes celles enregistrées dans le jeu.
 *
 * « Offrande du Dieu de la Mort » n'est volontairement pas exclue du tirage : elle peut se
 * re-piocher elle-même, et donc s'enchaîner sur plusieurs tours (choix assumé).
 * Le tirage passe par le RNG seedé de la partie, jamais par Math.random.
 */
function drawObjectCardIds(rng: RngState, count: number): string[] {
  const pool = listCards()
    .filter((c) => c.type === 'object')
    .map((c) => c.id);
  const drawn: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = randomInt(rng, pool.length);
    drawn.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return drawn;
}

/** `card` sur chaque option : la modale affiche les illustrations réelles au lieu d'une liste de noms. */
function asCardOptions(cardIds: string[]): ChoiceOption[] {
  return cardIds.map((cardId) => ({
    key: cardId,
    label: listCards().find((c) => c.id === cardId)?.name ?? cardId,
    card: { cardId, kind: 'object' as const },
  }));
}

export const offrandeDuDieuDeLaMort: ObjectCardDef = {
  type: 'object',
  id: 'offrande-du-dieu-de-la-mort',
  name: 'Offrande du Dieu de la Mort',
  description:
    'Une sélection de 6 cartes objets aléatoire dans le jeu se présente à vous, choisissez en une. Une sélection de 2 cartes objets aléatoire dans le jeu se présente à votre adversaire, il en choisi une.',
  async execute(ctx) {
    // Les deux prompts sont séquentiels : le moteur n'autorise qu'une question ouverte à
    // la fois, même adressée à deux joueurs différents.
    await offer(ctx.ownerId, OWNER_CHOICE_COUNT, 'Offrande du Dieu de la Mort : choisissez une carte objet');
    await offer(
      ctx.opponentId,
      OPPONENT_CHOICE_COUNT,
      'Offrande du Dieu de la Mort : votre adversaire vous offre une carte, choisissez-en une'
    );

    async function offer(playerId: PlayerId, count: number, prompt: string): Promise<void> {
      const candidates = drawObjectCardIds(ctx.state.rng, count);
      if (candidates.length === 0) return;
      const chosen = await ctx.chooseOptionFor(playerId, prompt, asCardOptions(candidates));
      // La réponse est déjà validée contre les options par Match.answerChoice ; le repli
      // couvre seulement le cas d'un timeout résolu par défaut.
      const cardId = candidates.includes(chosen) ? chosen : candidates[0]!;
      // La carte rejoint la réserve non jouée : elle se jouera un autre tour, dans la
      // limite habituelle des 2 objets par tour.
      ctx.createObject(cardId, playerId);
    }
  },
};
