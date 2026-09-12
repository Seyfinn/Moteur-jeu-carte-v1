import type { ObjectCardDef } from '../types.js';
import type { GameState } from '../../types.js';
import { attacksAvailableTo, canAttack } from '../../queries.js';
import { cardName } from '../../names.js';

const DAMAGE_CAP = 5;

/**
 * Les attaques que ce personnage du banc peut réellement porter : celles qu'il a en main
 * (`attacksAvailableTo`, l'empruntée du Livre de Chrollo comprise -- jamais
 * `getCharacterCard(...).attacks` en direct, cf. CLAUDE.md) et que `canAttack` ne refuse
 * pas une par une (stun, désarmé, sceau de Makima, attaque empruntée qui ferme les siennes).
 * On court-circuite complètement le handleAttack normal, donc ses gardes sont rejoués ici.
 */
function attackIdsUsableBy(state: GameState, characterInstanceId: string): string[] {
  return attacksAvailableTo(state, characterInstanceId)
    .filter((a) => canAttack(state, characterInstanceId, a.id).allow)
    .map((a) => a.id);
}

export const coupDeMain: ObjectCardDef = {
  type: 'object',
  id: 'coup-de-main',
  name: 'Coup de main',
  description:
    'Permet à une carte sur le banc d’attaquer sans mettre fin au tour. Néanmoins cette attaque inflige maximum 5 de dégâts.',
  unplayableReason(state, ownerId) {
    const bench = state.players[ownerId].benchCharacterInstanceIds;
    const eligible = bench.filter((id) => {
      const c = state.players[ownerId].characters[id];
      return !!c && attackIdsUsableBy(state, id).length > 0;
    });
    if (eligible.length === 0) {
      return "Aucun personnage du banc n'est en état d'attaquer (banc vide, étourdi ou désarmé).";
    }
    return null;
  },
  async execute(ctx) {
    const eligible = ctx.getBench(ctx.ownerId).filter((c) => attackIdsUsableBy(ctx.state, c.instanceId).length > 0);
    if (eligible.length === 0) return;

    const [benchCharId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Coup de main : choisissez le personnage du banc qui attaque',
      options: eligible.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!benchCharId) return;

    // Contexte reconstruit pour le personnage du banc, pas pour Coup de main : l'attaque
    // doit se calculer avec SES stats/passifs (ATK, esquive, critique), pas ceux de
    // l'objet. Voir EffectContext.buildEffectContext (cards/types.ts) -- à distinguer du
    // pattern "j'emprunte et je relance en mon nom" de Zoé/Kakashi (zoe.ts, kakashi.ts),
    // qui réutilisent leur PROPRE ctx : ici c'est bien le personnage du banc qui attaque,
    // pas Coup de main.
    const benchCtx = ctx.buildEffectContext(benchCharId, 'attack');

    const benchCardId = ctx.getCharacter(benchCharId).cardId;
    const usableIds = new Set(attackIdsUsableBy(ctx.state, benchCharId));
    const attacksAvailable = attacksAvailableTo(ctx.state, benchCharId).filter(
      (a) => usableIds.has(a.id) && (!a.condition || a.condition(benchCtx))
    );
    if (attacksAvailable.length === 0) return;

    const attackId = await ctx.chooseOption(
      "Coup de main : choisissez l'attaque à utiliser",
      attacksAvailable.map((a) => ({ key: a.id, label: a.name }))
    );
    const attack = attacksAvailable.find((a) => a.id === attackId) ?? attacksAvailable[0]!;

    ctx.log(`Coup de main : ${cardName(benchCardId)} attaque depuis le banc avec ${attack.name}`, {
      characterInstanceId: benchCharId,
      attackId: attack.id,
    });

    // Plafond de 5 dégâts au TOTAL sur cette résolution (pas par instance de dégâts) :
    // une attaque qui toucherait plusieurs fois ne doit pas dépasser 5 en cumulé. Le
    // reste de l'attaque (esquive, critique, effets secondaires -- poison, désarmement,
    // silence...) passe par benchCtx sans modification, seul dealDamage est intercepté.
    let dealtSoFar = 0;
    const cappedCtx = {
      ...benchCtx,
      async dealDamage(targetInstanceId: string, amount: number, options?: Parameters<typeof benchCtx.dealDamage>[2]) {
        const room = Math.max(0, DAMAGE_CAP - dealtSoFar);
        const capped = Math.min(amount, room);
        dealtSoFar += capped;
        if (capped > 0) await benchCtx.dealDamage(targetInstanceId, capped, options);
      },
    };

    await attack.execute(cappedCtx);
  },
};
