import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;
const OWNER_SWITCH_DAMAGE = 30;
const OPPONENT_SWITCH_DAMAGE = 50;

export const salleDeGravite: TerrainCardDef = {
  type: 'terrain',
  id: 'salle-de-gravite',
  name: 'Salle de Gravité',
  description:
    `Chaque fois qu'un joueur effectue un switch , son nouveau personnage qui arrive sur le poste actif subit des dégâts . Le poseur du terrain subit 30 dégâts, tandis que l'adversaire subit 50 dégâts. (Ne s'applique pas au remplacement d'un personnage KO).
`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'salle-de-gravite-ecrasement',
      name: 'Salle de Gravité',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "Punit quiconque switch : le nouvel actif encaisse des dégâts, plus lourds pour l'adversaire du poseur.",
      trigger: 'onSwitch',
      async execute(ctx) {
        const switchingPlayerId = ctx.event?.playerId;
        const newActiveInstanceId = ctx.event?.data['newActiveInstanceId'] as string | undefined;
        if (!switchingPlayerId || !newActiveInstanceId) return;
        const amount = switchingPlayerId === ctx.ownerId ? OWNER_SWITCH_DAMAGE : OPPONENT_SWITCH_DAMAGE;
        // Traité comme un aléa d'environnement (pas une attaque) : jamais esquivable,
        // qu'il s'agisse du camp du poseur ou de l'adversaire.
        await ctx.dealDamage(newActiveInstanceId, amount, { skipEvasionRoll: true });
      },
    },
  ],
};
