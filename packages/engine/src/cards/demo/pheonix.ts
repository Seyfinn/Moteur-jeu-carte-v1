import type { ObjectCardDef } from '../types.js';

const REVIVE_DELAY_TURNS = 10;
const BONUS_MAX_HP = 80;
const BONUS_ATK = 30;

export const pheonix: ObjectCardDef = {
  type: 'object',
  id: 'pheonix',
  name: 'Pheonix',
  // À lier (maquette) : s'accroche à sa cible (ctx.attachSelfTo ci-dessous) avant de la
  // tuer, ce qui envoie l'objet au cimetière avec elle dans la foulée (zones.koCharacter) --
  // même destination qu'avant, mais désormais affichée comme un vrai lien le temps du coup.
  // Le compte à rebours, lui, vit toujours sur le joueur (PlayerState.pendingRevives), pas
  // sur la carte : un objet au cimetière ne peut porter aucun statut/minuteur.
  equipment: true,
  description:
    `Tue ce personnage, au bout de ${REVIVE_DELAY_TURNS} tours, le réanime avec ${BONUS_MAX_HP}pv max supplémentaire et ` +
    `${BONUS_ATK} d'attaque supplémentaire. Si il ne vous reste plus qu'un personnage en vie. Cette carte ne ferra pas effet.`,
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const aliveCount = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id) => id !== null
    ).length;
    // « Si il ne vous reste plus qu'un personnage en vie, cette carte ne ferra pas
    // effet » : tuer son dernier personnage, c'est perdre la partie sur-le-champ
    // (checkWinCondition compte les personnages sur le plateau).
    if (aliveCount <= 1) {
      return "Il ne vous reste qu'un personnage en vie : la carte ne ferait pas effet.";
    }
    return null;
  },
  async execute(ctx) {
    const candidates = ctx.getAllOnBoard(ctx.ownerId);
    if (candidates.length <= 1) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Pheonix : choisissez le personnage à sacrifier',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);

    // Tuer d'abord, programmer ensuite : scheduleRevive n'accepte qu'une cible déjà au
    // cimetière (c'est ce qui garantit qu'on ne planifie pas le retour d'un vivant).
    await ctx.koCharacter(targetId);
    ctx.scheduleRevive(targetId, {
      turns: REVIVE_DELAY_TURNS,
      bonusMaxHP: BONUS_MAX_HP,
      bonusATK: BONUS_ATK,
    });
  },
};
