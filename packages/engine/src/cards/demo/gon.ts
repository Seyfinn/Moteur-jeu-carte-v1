import type { CharacterCardDef, EffectContext } from '../types.js';
import { getStatus } from '../../statuses.js';
import { canTargetBench } from '../../queries.js';
import { cardName } from '../../names.js';

const LA_PIERRE_ATK = 40;
/** Manche à laquelle la Cible cesse d'être un secret (`state.turnNumber`, cf. CLAUDE.md). */
const REVEAL_TURN = 10;

export const GON_ADULTE_CARD_ID = 'gon-adulte';

/**
 * Mémoire de la Cible, portée par GON lui-même et non par la victime : un statut posé sur
 * l'adversaire disparaîtrait avec elle au cimetière, juste au moment où il faut le relire.
 * `hidden` -- c'est tout l'intérêt de la carte : ni badge, ni ligne de journal, donc
 * l'adversaire ne voit strictement rien tant que la révélation n'a pas eu lieu.
 */
const TARGET_RECORD_STATUS_ID = 'gon-cible-record';
/** Badge posé sur la Cible au tour 10, celui-là bien visible des deux camps. */
const TARGET_REVEALED_STATUS_ID = 'gon-cible';

interface TargetRecord {
  targetInstanceId: string;
  revealed: boolean;
}

function targetRecord(ctx: EffectContext): TargetRecord | undefined {
  const data = getStatus(ctx.getCharacter(ctx.sourceInstanceId), TARGET_RECORD_STATUS_ID)?.data;
  const targetInstanceId = data?.['targetInstanceId'];
  if (typeof targetInstanceId !== 'string') return undefined;
  return { targetInstanceId, revealed: data?.['revealed'] === true };
}

function writeTargetRecord(ctx: EffectContext, record: TargetRecord): void {
  if (getStatus(ctx.getCharacter(ctx.sourceInstanceId), TARGET_RECORD_STATUS_ID)) {
    ctx.removeStatus(ctx.sourceInstanceId, TARGET_RECORD_STATUS_ID);
  }
  ctx.applyStatus(ctx.sourceInstanceId, {
    statusId: TARGET_RECORD_STATUS_ID,
    label: 'Cible du Serment',
    sourceCardInstanceId: ctx.sourceInstanceId,
    hidden: true,
    data: { ...record },
  });
}

/** Personnages adverses que Gon a le droit de désigner (le banc reste soumis aux protections). */
function designatableEnemies(ctx: EffectContext) {
  const activeId = ctx.state.players[ctx.opponentId].activeCharacterInstanceId;
  return ctx
    .getAllOnBoard(ctx.opponentId)
    .filter(
      (c) =>
        c.instanceId === activeId ||
        canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow
    );
}

export const gon: CharacterCardDef = {
  type: 'character',
  id: 'gon',
  name: 'Gon',
  baseMaxHP: 80,
  evolvesTo: GON_ADULTE_CARD_ID,
  attacks: [
    {
      id: 'la-pierre',
      name: 'La Pierre',
      baseATK: LA_PIERRE_ATK,
      // Pas de texte d'attaque sur la carte : description implicite.
      description: `Inflige ${LA_PIERRE_ATK} dégâts à l'actif adverse.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, LA_PIERRE_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'sermet-de-vengance',
      name: 'Sermet de Vengance',
      kind: 'passive',
      description:
        'Au début de la partie, une carte adverse est secrètement désignée comme Cible (révélée au Tour 10 à l’adversaire). Si la Cible est éliminée, Gon évolue en Gon Adulte et soigne tous ses PV.',
      // Une seule passive imprimée qui surveille trois moments : la désignation, la
      // révélation, l'élimination. Une capacité par event afficherait trois fois la même
      // ligne sur la carte (cf. CLAUDE.md).
      trigger: ['onGameStart', 'onTurnStart', 'onCharacterKO'],
      // Gon peut très bien être au banc à la désignation, au tour 10, ou quand la Cible meurt.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        const record = targetRecord(ctx);
        switch (ctx.event?.name) {
          case 'onGameStart':
            return record === undefined && designatableEnemies(ctx).length > 0;
          case 'onTurnStart':
            // Révélation une seule fois, au premier tour atteignant la 10e manche. `>=`
            // plutôt que `===` : si Gon arrivait en jeu plus tard (Mode Pioche), il ne
            // faut pas que la manche 10 déjà passée enterre la révélation pour de bon.
            if (!record || record.revealed) return false;
            if (ctx.state.turnNumber < REVEAL_TURN) return false;
            return !ctx.isKO(record.targetInstanceId);
          case 'onCharacterKO':
            return !!record && ctx.event?.data['characterInstanceId'] === record.targetInstanceId;
          default:
            return false;
        }
      },
      async execute(ctx) {
        switch (ctx.event?.name) {
          case 'onGameStart': {
            const enemies = designatableEnemies(ctx);
            const [targetInstanceId] = await ctx.choose({
              kind: 'select-characters',
              prompt: 'Sermet de Vengance : désignez secrètement votre Cible',
              options: enemies.map((c) => c.instanceId),
              min: 1,
              max: 1,
            });
            if (!targetInstanceId) return;
            // Volontairement AUCUN `ctx.log` ici : le journal est commun aux deux joueurs
            // (getPlayerView ne le filtre pas), une ligne suffirait à vendre la mèche.
            writeTargetRecord(ctx, { targetInstanceId, revealed: false });
            return;
          }

          case 'onTurnStart': {
            const record = targetRecord(ctx);
            if (!record) return;
            const target = ctx.getCharacter(record.targetInstanceId);
            ctx.applyStatus(
              record.targetInstanceId,
              {
                statusId: TARGET_REVEALED_STATUS_ID,
                label: 'Cible de Gon',
                sourcePlayerId: ctx.ownerId,
                sourceCardInstanceId: ctx.sourceInstanceId,
              },
              { skipEvasionRoll: true } // une désignation ne s'esquive pas
            );
            ctx.log(`${cardName(target.cardId)} est la Cible du Sermet de Vengance de Gon`, {
              kind: 'status',
              characterInstanceId: record.targetInstanceId,
            });
            writeTargetRecord(ctx, { ...record, revealed: true });
            return;
          }

          case 'onCharacterKO': {
            if (ctx.isKO(ctx.sourceInstanceId)) return; // un Gon mort ne grandit plus
            ctx.removeStatus(ctx.sourceInstanceId, TARGET_RECORD_STATUS_ID);
            // Une seule forme déclarée : pas de `toCardId` à nommer.
            if (!(await ctx.evolveCharacter(ctx.sourceInstanceId))) return;
            if (ctx.isKO(ctx.sourceInstanceId)) return;
            // « soigne tous ses PV » : le plafond est déjà celui de Gon Adulte à ce stade.
            ctx.heal(ctx.sourceInstanceId, ctx.getCharacter(ctx.sourceInstanceId).currentMaxHP);
            return;
          }
        }
      },
    },
  ],
};
