import type { ObjectCardDef } from '../types.js';

/**
 * Interdit de jouer "Attaque cloné" quand un de ces personnages est au poste actif :
 * l'interaction est jugée trop puissante (Locke double-attaquerait avec Marteau, un clou de
 * plus par tour vers l'explosion garantie ; Light Yagami et Yumeko profitent chacun d'une
 * seconde chance de déclencher leur propre effet sur-coup dans le même tour ; Kayn de même).
 * Blocage volontairement au niveau de la carte (liste en dur), pas un modifier générique :
 * rien d'autre dans le moteur n'a besoin de refuser "par personnage nommé".
 */
const BANNED_ACTIVE_CARD_IDS = ['locke', 'light-yagami', 'yumeko', 'kayn'];

const EXTRA_ATTACKS = 1;
const SECOND_ATTACK_DAMAGE_PERCENT = 50;
const SILENCE_EFFECTIVE_TURNS = 2;
// Pas de `+1` ici, contrairement à tous les autres statuts bloquants : ce silence n'est
// pas posé maintenant mais à l'expiration de 'extra-attack', donc au début du tour
// suivant et APRÈS la passe de décompte de ce tour-là (voir StatusInstance.onExpire).
// Il n'est donc jamais décompté à vide, et couvre exactement les 2 tours suivants -- le
// tour où la carte est jouée reste libre, comme le dit « aux 2 prochains tours ».
const SILENCE_REMAINING_TURNS = SILENCE_EFFECTIVE_TURNS;

export const attaqueClone: ObjectCardDef = {
  type: 'object',
  id: 'attaque-clone',
  // À lier (maquette) : s'accroche au porteur (ctx.attachSelfTo ci-dessous) pour toute la
  // durée où son effet est encore actif (double-attaque puis silence). Le statut posé en
  // `onExpire` porte `data.objectInstanceId` : le moteur détruit l'objet tout seul quand ce
  // silence expire naturellement (statuses.ts), donc rien ne reste accroché pour rien une
  // fois l'effet réellement terminé.
  equipment: true,
  name: 'Attaque cloné',
  description:
    'Permet d’attaquer deux fois pendant ce tour, la deuxième attaque inflige ' +
    `${SECOND_ATTACK_DAMAGE_PERCENT}% des dégâts. Incapable d’utiliser son actif aux ` +
    `${SILENCE_EFFECTIVE_TURNS} prochains tours.`,
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const activeId = player.activeCharacterInstanceId;
    if (!activeId) {
      return "Vous n'avez pas de personnage actif pour attaquer.";
    }
    const activeCardId = player.characters[activeId]?.cardId;
    if (activeCardId && BANNED_ACTIVE_CARD_IDS.includes(activeCardId)) {
      return 'Interaction trop puissante.';
    }
    return null;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;

    ctx.attachSelfTo(active.instanceId);

    // Statut générique du moteur ('extra-attack', cf. types.ts) : la carte ne fait que le
    // poser. C'est `match.ts::applyAction` qui, après une attaque, dépense une charge au
    // lieu de terminer le tour, et `getEffectiveATK` qui applique la décote au coup suivant.
    ctx.applyStatus(active.instanceId, {
      statusId: 'extra-attack',
      label: 'Attaque cloné',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      // Cadré sur le tour en cours : une charge non consommée ne doit pas se reporter.
      // `ticksOnBench` pour qu'un passage au banc juste après ne gèle pas la durée.
      remainingTurns: 1,
      ticksOnBench: true,
      data: { remaining: EXTRA_ATTACKS, damagePercent: SECOND_ATTACK_DAMAGE_PERCENT },
      // Le prix de la carte, armé seulement quand la fenêtre de double attaque se referme.
      // Posé même si le joueur n'a finalement pas attaqué deux fois : la contrepartie est
      // due dans tous les cas.
      onExpire: {
        statusId: 'silence-active',
        label: 'Attaque cloné',
        sourcePlayerId: ctx.ownerId,
        remainingTurns: SILENCE_REMAINING_TURNS,
        ticksOnBench: true,
        // Convention 'damage-reflect' réutilisée ici pour une expiration NATURELLE (pas
        // une consommation sur coup) : à la toute fin du silence, statuses.ts détruit
        // l'objet qui a posé ce statut au lieu de le laisser accroché indéfiniment.
        data: { objectInstanceId: ctx.sourceInstanceId },
      },
    });
  },
};
