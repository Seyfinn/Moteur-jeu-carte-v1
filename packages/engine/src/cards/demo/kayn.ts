import type { CharacterCardDef, EffectContext } from '../types.js';
import { getStatus } from '../../statuses.js';

const FAUX_ATK = 40;
const ATTACKS_BEFORE_EVOLUTION = 3;

/** Les deux voies déclarées par `evolvesTo`, partagées avec les fichiers des formes. */
export const KAYN_ASSASSIN_CARD_ID = 'kayn-assassin';
export const RHAAST_CARD_ID = 'rhaast';

/** Voie retenue par « Eveil du Darkin », relue au moment de la transformation. */
const PATH_STATUS_ID = 'kayn-darkin-path';
/**
 * Compteur d'attaques portées. Pas de `remainingTurns` : il ne doit jamais être retiré
 * par la passe de décompte, il survit aux allers-retours au banc.
 */
const ATTACK_COUNT_STATUS_ID = 'kayn-faux-count';

function pathOf(ctx: EffectContext): string | undefined {
  const recorded = getStatus(ctx.getCharacter(ctx.sourceInstanceId), PATH_STATUS_ID);
  const cardId = recorded?.data?.['cardId'];
  return typeof cardId === 'string' ? cardId : undefined;
}

async function askPath(ctx: EffectContext): Promise<string> {
  return ctx.chooseOption('Eveil du Darkin : quelle voie Kayn emprunte-t-il ?', [
    { key: RHAAST_CARD_ID, label: 'La voie de Rhaast', card: { cardId: RHAAST_CARD_ID, kind: 'character' } },
    {
      key: KAYN_ASSASSIN_CARD_ID,
      label: "La voie de l'assassin",
      card: { cardId: KAYN_ASSASSIN_CARD_ID, kind: 'character' },
    },
  ]);
}

/**
 * « Faux du Darkin » : la passive est purement descriptive, la mécanique vit ici parce
 * qu'elle doit compter l'attaque APRÈS sa résolution (le 3e coup est encore porté par
 * Kayn, la transformation n'arrive qu'ensuite) et qu'aucun event « après attaque »
 * n'existe côté moteur.
 */
async function advanceDarkin(ctx: EffectContext): Promise<void> {
  if (ctx.isKO(ctx.sourceInstanceId)) return;

  const counter = getStatus(ctx.getCharacter(ctx.sourceInstanceId), ATTACK_COUNT_STATUS_ID);
  const count = Number(counter?.data?.['count'] ?? 0) + 1;
  if (counter) ctx.removeStatus(ctx.sourceInstanceId, ATTACK_COUNT_STATUS_ID);
  ctx.applyStatus(ctx.sourceInstanceId, {
    statusId: ATTACK_COUNT_STATUS_ID,
    label: 'Faux du Darkin (attaques portées)',
    sourceCardInstanceId: ctx.sourceInstanceId,
    hidden: true, // compteur interne, la transformation s'annonce toute seule
    data: { count },
  });
  if (count < ATTACKS_BEFORE_EVOLUTION) return;

  // La voie est normalement déjà fixée depuis l'arrivée de Kayn au poste actif. Filet de
  // sécurité s'il était réduit au silence passif à ce moment-là : on la lui demande
  // maintenant plutôt que de bloquer la transformation pour le reste de la partie.
  const path = pathOf(ctx) ?? (await askPath(ctx));
  const evolved = await ctx.evolveCharacter(ctx.sourceInstanceId, path);
  if (!evolved || ctx.isKO(ctx.sourceInstanceId)) return;

  // « Double ses hp actuels » : c'est un soin, donc plafonné aux PV max (240 pour les deux
  // formes). Soigner exactement les PV restants revient à les doubler sans les dépasser.
  const evolvedSelf = ctx.getCharacter(ctx.sourceInstanceId);
  ctx.heal(ctx.sourceInstanceId, evolvedSelf.currentMaxHP - evolvedSelf.damage);
}

export const kayn: CharacterCardDef = {
  type: 'character',
  id: 'kayn',
  name: 'Kayn',
  baseMaxHP: 240,
  evolvesTo: [RHAAST_CARD_ID, KAYN_ASSASSIN_CARD_ID],
  attacks: [
    {
      id: 'faux',
      name: 'Faux',
      baseATK: FAUX_ATK,
      // Pas de texte d'attaque sur la carte : description implicite, comme partout ailleurs.
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) {
          const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, FAUX_ATK);
          await ctx.dealDamage(target.instanceId, atk);
        }
        await advanceDarkin(ctx);
      },
    },
  ],
  abilities: [
    {
      id: 'faux-du-darkin',
      name: 'Faux du Darkin',
      kind: 'passive',
      description:
        'Après 3 attaques, kayn de transforme immédiatement, selon la voie qu’il a choisi. Double ses hp actuels lors de la transformation.',
      // Purement descriptive : le compteur et la transformation vivent dans l'AttackDef.
      async execute() {},
    },
    {
      id: 'eveil-du-darkin',
      name: 'Eveil du Darkin',
      kind: 'passive',
      description:
        'Dès que Kayn est posé, le joueur décide si Kayn choisi la voie de Rhaast ou la voie de l’assassin.',
      trigger: 'onBecomeActive',
      // Il n'existe pas d'event « personnage posé » : tout le monde est en jeu dès le
      // départ. L'arrivée au poste actif (y compris comme actif de départ, reason 'setup')
      // est le premier moment où Kayn entre réellement en scène.
      usesPerTurn: Infinity,
      condition(ctx) {
        if (ctx.event?.data['characterInstanceId'] !== ctx.sourceInstanceId) return false;
        return pathOf(ctx) === undefined; // la voie ne se rechoisit pas à chaque retour
      },
      async execute(ctx) {
        const path = await askPath(ctx);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: PATH_STATUS_ID,
          label: 'Voie du Darkin',
          sourceCardInstanceId: ctx.sourceInstanceId,
          hidden: true, // le choix est annoncé dans le journal, un badge en plus n'apprend rien
          data: { cardId: path },
        });
        ctx.log(
          path === RHAAST_CARD_ID
            ? 'Kayn choisit la voie de Rhaast'
            : "Kayn choisit la voie de l'assassin",
          { kind: 'status', characterInstanceId: ctx.sourceInstanceId }
        );
      },
    },
  ],
};
