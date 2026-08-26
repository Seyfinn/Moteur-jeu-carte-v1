import type { CharacterCardDef } from '../types.js';
import { getStatus, hasStatus } from '../../statuses.js';

/** Les trois mises proposées par "Mise à mort", dans l'ordre où la modale les présente. */
const BETS = [40, 60, 70] as const;
const WIN_PERCENT = 50;
/** Victoire : le bonus vaut le double de la mise. */
const WIN_MULTIPLIER = 2;

/**
 * Le gain d'un pari remporté, en attente de l'attaque. `data.bonus` = dégâts bonus.
 * Il ne vaut que le tour du pari : posé pendant le tour de Yumeko, `remainingTurns: 1`
 * le fait sauter au début de son tour suivant (pas de +1, ce n'est pas un statut bloquant).
 * `ticksOnBench` parce qu'un pari peut être lancé depuis le banc : sans lui, la durée y
 * serait suspendue et le gain reviendrait intact des tours plus tard.
 */
const BET_WON_STATUS_ID = 'yumeko-pari-gagne';

/**
 * "Bonus" : la partie du banc, jouable une seule fois. Le statut est posé au moment où
 * Mise à mort part du banc, et il ouvre l'attaque depuis le banc pour ce tour-là
 * (modifier `canAttackFromBench` plus bas) -- la mise et le coup qu'elle paie forment un
 * seul et même passage, c'est lui qui est limité à une fois par partie.
 */
const BENCH_TURN_STATUS_ID = 'yumeko-bonus-tour';
/** Trace définitive : le passage du banc a été consommé, il ne reviendra pas. */
const BENCH_SPENT_STATUS_ID = 'yumeko-bonus-utilise';

export const yumeko: CharacterCardDef = {
  type: 'character',
  id: 'yumeko',
  name: 'Yumeko',
  baseMaxHP: 140,
  attacks: [
    {
      id: 'mise-a-fond',
      name: 'Mise a Fond',
      baseATK: 0,
      description: 'Calculé par rapport à Mise à Mort',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // 0 de base : tout le coup vient du pari remporté, via le modifier getEffectiveATK.
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, 0);
        await ctx.dealDamage(target.instanceId, atk);
        // Le gain paie une attaque, pas le tour : consommé même si le coup a été esquivé.
        ctx.removeStatus(ctx.sourceInstanceId, BET_WON_STATUS_ID);
      },
    },
  ],
  abilities: [
    {
      id: 'mise-a-mort',
      name: 'Mise à mort',
      kind: 'active',
      description:
        "Au début de ton tour, tu peux choisir de parier 40, 60, 70 PV de Yumeko.\n\nVictoire (50 %) : L'attaque de Yumeko gagne le double des PV pariés en dégâts bonus.\n\nDéfaite (50 %) : Yumeko subit immédiatement les PV pariés sous forme de dégâts directs.",
      // Ouvert au banc par "Bonus", mais une seule fois de la partie (garde ci-dessous).
      usableFromBench: true,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const isActive = ctx.state.players[ctx.ownerId].activeCharacterInstanceId === ctx.sourceInstanceId;
        if (isActive) return true;
        return !hasStatus(self, BENCH_SPENT_STATUS_ID);
      },
      async execute(ctx) {
        const isActive = ctx.state.players[ctx.ownerId].activeCharacterInstanceId === ctx.sourceInstanceId;
        // Depuis le poste actif, Mise à mort est gratuite et répétable ; depuis le banc, elle
        // dépense "Bonus". Le passage se consomme à l'engagement de la mise, pas à l'attaque :
        // une mise perdue depuis le banc a bel et bien brûlé l'unique fois de la partie.
        if (!isActive) {
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: BENCH_SPENT_STATUS_ID,
            label: 'Bonus (utilisé)',
            hidden: true,
          });
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: BENCH_TURN_STATUS_ID,
            label: 'Bonus : peut attaquer depuis le banc',
            // Ce tour-ci seulement, et la durée doit descendre au banc -- c'est là qu'elle vit.
            remainingTurns: 1,
            ticksOnBench: true,
          });
        }

        const betKey = await ctx.chooseOption(
          'Mise à mort : combien de PV pariez-vous ?',
          BETS.map((b) => ({ key: String(b), label: `${b} PV` }))
        );
        const bet = Number(betKey);
        if (!BETS.includes(bet as (typeof BETS)[number])) return;

        if (ctx.rollChance(WIN_PERCENT, 'Mise à mort', { characterInstanceId: ctx.sourceInstanceId })) {
          const bonus = bet * WIN_MULTIPLIER;
          // Un nouveau pari remplace le précédent : `applyStatus` réécrit l'instance
          // existante, les gains ne s'empilent pas d'un tour sur l'autre.
          ctx.removeStatus(ctx.sourceInstanceId, BET_WON_STATUS_ID);
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: BET_WON_STATUS_ID,
            label: `Pari gagné (+${bonus})`,
            remainingTurns: 1,
            ticksOnBench: true,
            data: { bonus },
          });
          ctx.log(`Mise à mort : pari de ${bet} PV remporté, l'attaque de Yumeko gagne ${bonus} dégâts`, {
            kind: 'status',
            characterInstanceId: ctx.sourceInstanceId,
          });
        } else {
          ctx.log(`Mise à mort : pari de ${bet} PV perdu`, { kind: 'info', characterInstanceId: ctx.sourceInstanceId });
          // Dégâts ordinaires, volontairement : bouclier et réductions ont le droit de les
          // absorber (choix de design assumé, cf. docs/cartes.md). Yumeko peut en mourir.
          await ctx.dealDamage(ctx.sourceInstanceId, bet);
        }
      },
    },
    {
      id: 'bonus',
      name: 'Bonus',
      kind: 'passive',
      description: "Peut utiliser Mise à Mort sur le Banc, Utilisable qu'une seul fois",
      // Purement descriptive : la permission vit dans `usableFromBench` de Mise à mort et
      // dans le modifier 'canAttackFromBench' ci-dessous.
      async execute() {},
    },
  ],
  modifiers: [
    {
      // "Mise a Fond" : les dégâts bonus du pari remporté. Passer par l'ATK effectif plutôt
      // que par une addition dans l'attaque, pour que buffs et malus s'appliquent au total.
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const self = ctx.state.players[ctx.sourceOwnerId].characters[ctx.sourceInstanceId];
        if (!self) return current;
        const bonus = Number(getStatus(self, BET_WON_STATUS_ID)?.data?.['bonus'] ?? 0);
        return (current as number) + bonus;
      },
    },
    {
      // "Bonus" : le tour où la mise est partie du banc, Yumeko peut y porter son attaque.
      query: 'canAttackFromBench',
      vote(ctx) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return undefined;
        const self = ctx.state.players[ctx.sourceOwnerId].characters[ctx.sourceInstanceId];
        if (!self || !hasStatus(self, BENCH_TURN_STATUS_ID)) return undefined;
        return { allow: true, source: 'yumeko-bonus' };
      },
    },
  ],
};
