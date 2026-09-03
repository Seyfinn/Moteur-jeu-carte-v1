import type { EffectContext, TerrainCardDef } from '../types.js';
import type { ChoiceOption, PlayerId } from '../../types.js';
import { getObjectCard, listCards } from '../registry.js';
import { randomInt } from '../../rng.js';

const DURATION_TURNS = 5;

/**
 * L'objet confié par un camp, rangé dans le `data` libre de l'instance de terrain sous la
 * forme d'un simple `cardId`. L'`ObjectInstance` d'origine est détruite en entrant dans le
 * dé et une neuve est fabriquée à la sortie (`ctx.createObject`) : garder l'instance en vie
 * hors de toute zone n'apporterait rien -- le reroll change de toute façon la carte -- et
 * laisserait un objet fantôme dans `player.objects`.
 */
function heldBy(ctx: EffectContext, playerId: PlayerId): string | undefined {
  const raw = ctx.getTerrain(ctx.sourceInstanceId).data?.[playerId];
  return typeof raw === 'string' ? raw : undefined;
}

function setHeld(ctx: EffectContext, playerId: PlayerId, cardId: string | undefined): void {
  const terrain = ctx.getTerrain(ctx.sourceInstanceId);
  const data = { ...terrain.data };
  if (cardId === undefined) delete data[playerId];
  else data[playerId] = cardId;
  terrain.data = data;
}

/** « un autre objet du jeu de manière aléatoire » : tout le registre, sauf la face actuelle. */
function reroll(ctx: EffectContext, currentCardId: string): string {
  const pool = listCards()
    .filter((card) => card.type === 'object')
    .map((card) => card.id)
    .filter((id) => id !== currentCardId);
  if (pool.length === 0) return currentCardId;
  return pool[randomInt(ctx.state.rng, pool.length)]!;
}

/** « Chaque joueur peut choisir de donner un de ses objets à Isaac D6 . » */
async function offerToGive(ctx: EffectContext, playerId: PlayerId): Promise<void> {
  const player = ctx.state.players[playerId];
  const candidates = player.unplayedObjectInstanceIds.filter((id) => player.objects[id]);
  if (candidates.length === 0) return;

  // « Garder » en tête de liste : un prompt laissé sans réponse est résolu par la première
  // option (defaultChoiceAnswer), et personne ne doit perdre une carte par silence.
  const options: ChoiceOption[] = [
    { key: 'garder', label: 'Ne rien confier' },
    ...candidates.map((instanceId) => {
      const cardId = player.objects[instanceId]!.cardId;
      return {
        key: instanceId,
        label: getObjectCard(cardId).name,
        card: { cardId, kind: 'object' as const },
      };
    }),
  ];
  const chosen = await ctx.chooseOptionFor(playerId, 'Isaac D6 : quel objet confier au dé ?', options);
  if (chosen === 'garder') return;

  const given = player.objects[chosen];
  if (!given) return;
  const idx = player.unplayedObjectInstanceIds.indexOf(chosen);
  if (idx !== -1) player.unplayedObjectInstanceIds.splice(idx, 1);
  delete player.objects[chosen];
  setHeld(ctx, playerId, given.cardId);
  ctx.log(`${getObjectCard(given.cardId).name} est confié à Isaac D6`, { kind: 'info', playerId });
}

/** « le joueur peut décider de prendre cet objet ou de le laisser pour qu'il soit reroll ». */
async function rerollAndOffer(ctx: EffectContext, playerId: PlayerId, currentCardId: string): Promise<void> {
  const rerolled = reroll(ctx, currentCardId);
  setHeld(ctx, playerId, rerolled);
  const def = getObjectCard(rerolled);
  ctx.log(`Isaac D6 relance : ${getObjectCard(currentCardId).name} devient ${def.name}`, { kind: 'info', playerId });

  const chosen = await ctx.chooseOptionFor(playerId, `Isaac D6 a fait sortir ${def.name}. Le prendre ?`, [
    { key: 'prendre', label: `Prendre ${def.name}` },
    { key: 'laisser', label: 'Le laisser (nouvelle relance au prochain tour)' },
  ]);
  if (chosen !== 'prendre') return;

  setHeld(ctx, playerId, undefined);
  // Gratuit et hors budget : la carte rejoint simplement la main, elle n'est pas jouée.
  ctx.createObject(rerolled, playerId);
  ctx.log(`${def.name} sort du dé et rejoint la main`, { kind: 'info', playerId });
}

export const isaacD6: TerrainCardDef = {
  type: 'terrain',
  id: 'isaac-d6',
  name: 'Isaac D6',
  description: `Chaque joueur peut choisir de donner un de ses objets à Isaac D6. Chaque tour, Isaac D6 reroll l'item, le transformant en un autre objet du jeu de manière aléatoire. 
Chaque tour, le joueur peut décider de prendre cet objet ou de le laisser pour qu'il soit reroll une nouvelle fois au tour suivant.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'isaac-d6-pose',
      name: 'Premier lancer',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "Celui qui pose le terrain est invité à confier un objet tout de suite, sans attendre son prochain tour.",
      trigger: 'onTerrainPlayed',
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return;
        // Le terrain arrive au milieu de son tour : son propre début de tour est déjà
        // passé, donc sans ça il attendrait un tour complet avant de pouvoir jouer avec.
        // L'adversaire, lui, sera servi normalement au début de son tour.
        setHeld(ctx, 'p1', undefined);
        setHeld(ctx, 'p2', undefined);
        await offerToGive(ctx, playerId);
      },
    },
    {
      id: 'isaac-d6-tour',
      name: 'Relance',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description:
        "Au début de son tour, chaque joueur relance l'objet qu'il a confié et décide de le prendre ou de le laisser tourner ; celui qui n'a rien confié se voit reproposer de le faire.",
      trigger: 'onTurnStart',
      condition(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return false;
        // Le décompte du terrain ne tourne que pendant les tours de son possesseur
        // (zones.tickTerrainAtTurnStart) et il tombe juste APRÈS ce `onTurnStart` : sur son
        // dernier tour, le possesseur n'a plus qu'à récupérer sa carte, pas à relancer dans
        // le vide. L'adversaire, lui, garde un tour complet devant lui, sans garde à poser.
        if (playerId !== ctx.ownerId) return true;
        const remaining = ctx.getTerrain(ctx.sourceInstanceId).remainingTurns;
        return remaining === undefined || remaining > 1;
      },
      async execute(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return;
        const held = heldBy(ctx, playerId);
        if (held === undefined) await offerToGive(ctx, playerId);
        else await rerollAndOffer(ctx, playerId, held);
      },
    },
    {
      id: 'isaac-d6-fin',
      name: 'Restitution',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "Quand le terrain part, tout objet encore dans le dé est rendu à son joueur, sous la face qu'il a alors.",
      trigger: 'onTerrainRemoved',
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          const held = heldBy(ctx, playerId);
          if (held === undefined) continue;
          setHeld(ctx, playerId, undefined);
          ctx.createObject(held, playerId);
          ctx.log(`Isaac D6 rend ${getObjectCard(held).name}`, { kind: 'info', playerId });
        }
      },
    },
  ],
};
