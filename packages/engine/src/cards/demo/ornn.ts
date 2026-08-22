import type { CharacterCardDef } from '../types.js';
import { getObjectCard, getTerrainCard } from '../registry.js';
import { getStatus, hasStatus } from '../../statuses.js';
import type { PlayerId } from '../../types.js';

const ATTACK_BASE_ATK = 40;
const LOCK_EFFECTIVE_TURNS = 3;
// +1 : voir katarina.ts / sion.ts -- statut posé sur SOI-MÊME pendant son propre
// tour, le tick de statuses.ts décrémente PUIS filtre avant que le joueur actif ne
// puisse agir ce tour-là, donc il faut compter un tour de plus que l'effet réel voulu.
const LOCK_REMAINING_TURNS = LOCK_EFFECTIVE_TURNS + 1;

const MATERIALS_STATUS_ID = 'ornn-materials-gathered';
const LOCK_TRACKER_STATUS_ID = 'ornn-forge-lock';

interface RecoverableCard {
  instanceId: string;
  kind: 'object' | 'terrain';
  ownerId: PlayerId;
  name: string;
}

export const ornn: CharacterCardDef = {
  type: 'character',
  id: 'ornn',
  name: 'Ornn',
  baseMaxHP: 600,
  attacks: [
    {
      id: 'recuperation-de-materiaux',
      name: 'Récupération de matériaux',
      baseATK: ATTACK_BASE_ATK,
      description: `Inflige ${ATTACK_BASE_ATK} dégâts à l'actif adverse. Débloque Living Forge pour le reste de la partie.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) {
          const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, ATTACK_BASE_ATK);
          await ctx.dealDamage(target.instanceId, atk);
        }
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (!hasStatus(self, MATERIALS_STATUS_ID)) {
          ctx.applyStatus(ctx.sourceInstanceId, { statusId: MATERIALS_STATUS_ID, label: 'Matériaux récupérés' });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'materiaux',
      name: 'Matériaux',
      kind: 'passive',
      description: 'Ornn ne peut pas utiliser Living Forge sans avoir utilisé "Récupération de matériaux" au moins une fois auparavant.',
      // Purement descriptive : la restriction vit dans le condition() de Living Forge.
      async execute() {},
    },
    {
      id: 'living-forge',
      name: 'Living Forge',
      kind: 'active',
      description: `Ornn se bloque sur le poste actif pendant ${LOCK_EFFECTIVE_TURNS} tours (ne peut ni attaquer ni switch). S'il est toujours vivant à l'issue, récupère un objet ou terrain au choix parmi les 4 cimetières (les vôtres et ceux de l'adversaire). Nécessite d'avoir utilisé "Récupération de matériaux" au préalable.`,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        if (!hasStatus(self, MATERIALS_STATUS_ID)) return false;
        if (hasStatus(self, LOCK_TRACKER_STATUS_ID)) return false; // déjà en cours
        return true;
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'disarmed',
          label: 'Living Forge (immobilisé)',
          remainingTurns: LOCK_REMAINING_TURNS,
        });
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'chained',
          label: 'Living Forge (immobilisé)',
          remainingTurns: LOCK_REMAINING_TURNS,
        });
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: LOCK_TRACKER_STATUS_ID,
          label: 'Living Forge (en cours)',
          remainingTurns: LOCK_REMAINING_TURNS,
        });
      },
    },
    {
      id: 'living-forge-reward',
      name: 'Living Forge (récompense)',
      kind: 'passive',
      description: "S'il survit aux 3 tours de Living Forge, récupère un objet ou terrain au choix parmi les 4 cimetières.",
      trigger: 'onTurnStart',
      // Doit rester déclenchable même si Ornn a été forcé hors de l'actif entre-temps
      // (ex: Hook de Blitzcrank -- forceSwitch contourne "chained").
      usableFromBench: true,
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        // onTurnStart est émis AVANT le tick qui décrémente/retire les statuts
        // (turn.ts::startTurn) -- remainingTurns === 1 signifie donc "le tick qui va
        // suivre retire le lock" : c'est exactement le tour où les 3 tours de blocage
        // viennent de s'écouler. Si Ornn est mort entre-temps, ce passive n'est plus
        // jamais scanné du tout (il n'est ni actif ni au banc) -- "toujours vivant"
        // est donc garanti sans vérification supplémentaire.
        return getStatus(self, LOCK_TRACKER_STATUS_ID)?.remainingTurns === 1;
      },
      async execute(ctx) {
        const candidates: RecoverableCard[] = [];
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          const player = ctx.state.players[playerId];
          for (const objectInstanceId of player.graveyardObjectInstanceIds) {
            const obj = player.objects[objectInstanceId];
            if (!obj) continue;
            candidates.push({ instanceId: objectInstanceId, kind: 'object', ownerId: playerId, name: getObjectCard(obj.cardId).name });
          }
          for (const terrainInstanceId of player.graveyardTerrainInstanceIds) {
            const terrain = player.terrains[terrainInstanceId];
            if (!terrain) continue;
            candidates.push({
              instanceId: terrainInstanceId,
              kind: 'terrain',
              ownerId: playerId,
              name: getTerrainCard(terrain.cardId).name,
            });
          }
        }
        if (candidates.length === 0) return;

        const chosenKey = await ctx.chooseOption(
          'Living Forge : choisissez la carte objet ou terrain à récupérer',
          candidates.map((c) => ({
            key: c.instanceId,
            label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'}${c.ownerId === ctx.ownerId ? '' : ', ennemi'})`,
          }))
        );
        const chosen = candidates.find((c) => c.instanceId === chosenKey);
        if (!chosen) return;

        const fromPlayer = ctx.state.players[chosen.ownerId];
        const toPlayer = ctx.state.players[ctx.ownerId];

        if (chosen.kind === 'object') {
          const idx = fromPlayer.graveyardObjectInstanceIds.indexOf(chosen.instanceId);
          if (idx !== -1) fromPlayer.graveyardObjectInstanceIds.splice(idx, 1);
          const obj = fromPlayer.objects[chosen.instanceId]!;
          delete fromPlayer.objects[chosen.instanceId];
          obj.ownerId = ctx.ownerId;
          toPlayer.objects[chosen.instanceId] = obj;
          toPlayer.unplayedObjectInstanceIds.push(chosen.instanceId);
        } else {
          const idx = fromPlayer.graveyardTerrainInstanceIds.indexOf(chosen.instanceId);
          if (idx !== -1) fromPlayer.graveyardTerrainInstanceIds.splice(idx, 1);
          const terrain = fromPlayer.terrains[chosen.instanceId]!;
          delete fromPlayer.terrains[chosen.instanceId];
          terrain.ownerId = ctx.ownerId;
          terrain.remainingTurns = undefined; // redéfini normalement à la prochaine pose
          toPlayer.terrains[chosen.instanceId] = terrain;
          toPlayer.unplayedTerrainInstanceIds.push(chosen.instanceId);
        }

        ctx.log(`Living Forge : récupère ${chosen.name}`, {
          instanceId: chosen.instanceId,
          kind: chosen.kind,
          fromPlayer: chosen.ownerId,
        });
      },
    },
  ],
};
