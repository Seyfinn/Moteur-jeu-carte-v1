import type { CharacterCardDef } from '../types.js';

const NARUKAMI_ATK = 60;
const DISARM_CHANCE_PERCENT = 33;
const DISARM_EFFECTIVE_TURNS = 1;
// Ciblé sur l'ennemi pendant le tour de Killua -> +1 (même correction que le Stun de
// Gojo / le Poison de Muzan, voir gojo-satoru.ts et muzan.ts).
const DISARM_REMAINING_TURNS = DISARM_EFFECTIVE_TURNS + 1;

const GODSPEED_READY_STATUS_ID = 'killua-godspeed-ready';
// +1, comme partout ailleurs (cf. CLAUDE.md) : le statut est posé au moment où Killua
// entre en poste actif, ce qui arrive soit en fin de tour (le switch est une action
// finale), soit pendant le tour adverse (remplacement après KO). Dans les deux cas le
// prochain tick est le début du tour où Killua veut attaquer -- avec remainingTurns: 1
// le "prêt" était donc retiré juste avant, et Godspeed ne se déclenchait jamais.
const GODSPEED_READY_REMAINING_TURNS = 2;

export const killua: CharacterCardDef = {
  type: 'character',
  id: 'killua',
  name: 'Killua',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'narukami',
      name: 'Narukami',
      baseATK: NARUKAMI_ATK,
      description: "Possède 33 % de chance d'appliquer l'état Désarmé au personnage actif adverse pendant 1 tour",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Godspeed : consomme le "prêt" posé par la passive, garanti pour cette seule
        // attaque (percent: 100 sur le statut 'critical' générique, retiré juste après
        // pour ne pas fausser les coups suivants -- voir rollCritical, statuses.ts).
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const godspeedReady = self.statuses.some((s) => s.statusId === GODSPEED_READY_STATUS_ID);
        if (godspeedReady) {
          ctx.removeStatus(ctx.sourceInstanceId, GODSPEED_READY_STATUS_ID);
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: 'critical',
            label: 'Critique garanti (Godspeed)',
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { percent: 100 },
          });
        }

        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, NARUKAMI_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        if (godspeedReady) {
          ctx.removeStatus(ctx.sourceInstanceId, 'critical');
        }

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && ctx.rollChance(DISARM_CHANCE_PERCENT, 'Désarmement', { characterInstanceId: target.instanceId })) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'disarmed',
            label: 'Désarmé (Narukami)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: DISARM_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'godspeed',
      name: 'Godspeed',
      kind: 'passive',
      description:
        "Lorsque Killua devient le personnage actif via un switch, la première attaque qu'il effectue lors de ce tour inflige obligatoirement un coup Critique",
      trigger: 'onBecomeActive',
      condition(ctx) {
        // 'setup' = personnage actif de départ : la carte dit "via un switch", donc la
        // mise en place initiale (et elle seule) ne doit pas armer le critique garanti.
        if (ctx.event?.data['reason'] === 'setup') return false;
        return ctx.event?.data['characterInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: GODSPEED_READY_STATUS_ID,
          label: 'Godspeed (prêt)',
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: GODSPEED_READY_REMAINING_TURNS,
        });
      },
    },
  ],
};

