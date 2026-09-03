import type { CharacterCardDef } from '../types.js';
import { getObjectCard, getTerrainCard } from '../registry.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';

const ATTACK_BASE_ATK = 40;
const FORGE_ATK_BONUS = 40;
const LOCK_EFFECTIVE_TURNS = 3;
// +1 : voir katarina.ts / sion.ts -- statut posé sur SOI-MÊME pendant son propre
// tour, le tick de statuses.ts décrémente PUIS filtre avant que le joueur actif ne
// puisse agir ce tour-là, donc il faut compter un tour de plus que l'effet réel voulu.
const LOCK_REMAINING_TURNS = LOCK_EFFECTIVE_TURNS + 1;

const MATERIALS_STATUS_ID = 'ornn-materials-gathered';
const LOCK_TRACKER_STATUS_ID = 'ornn-forge-lock';
const FORGE_COUNT_STATUS_ID = 'ornn-forges-completed';

interface RecoverableCard {
  instanceId: string;
  cardId: string;
  kind: 'object' | 'terrain';
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
      // Texte carte : "Inflige 40 dégâts supplémentaires par objet forgé." -- l'ATK de base
      // (40) est affiché implicitement comme les autres attaques (même convention que
      // Soraka/Guts), le texte ne décrit que le bonus par forge réussie (modifier
      // `getEffectiveATK` ci-dessous). Le déverrouillage de Living Forge, lui, est déjà
      // annoncé par le texte de la passive "Matériaux".
      description: 'Inflige 40 dégâts supplémentaires par objet forgé.',
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
      description: 'Ornn ne peut pas utiliser "Living Forge" sans avoir utilisé son attaque "Récupération de matériaux" auparavant.',
      // Purement descriptive : la restriction vit dans le condition() de Living Forge.
      async execute() {},
    },
    {
      id: 'living-forge',
      name: 'Living Forge',
      kind: 'active',
      description: 'Ornn construit un objet et est bloqué sur le poste actif pendant 3 tours, il ne peut ni attaquer ni switch. Si il est toujours vivant après les 3 tours, récupérer un objet ou terrain au choix parmi les 2 cimetières.',
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
          hidden: true, // doublon des badges "Living Forge (immobilisé)" déjà visibles
        });
      },
    },
    {
      id: 'living-forge-reward',
      name: 'Living Forge (récompense)',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "S'il survit aux 3 tours de Living Forge, récupère un objet ou terrain au choix parmi les 2 cimetières.",
      trigger: 'onTurnStart',
      // Doit rester déclenchable même si Ornn a quitté le poste actif entre-temps (le
      // "chained" de Living Forge bloque désormais aussi les switchs forcés, mais une
      // résurrection ou un échange de statuts peut encore l'en sortir).
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
        // Chaque forge réussie (Ornn a survécu aux 3 tours, qu'il y ait ou non quelque
        // chose à récupérer ensuite) alimente en permanence le bonus de dégâts de
        // "Récupération de matériaux" -- même schéma que le Berserk de Guts.
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const existingCount = getStatus(self, FORGE_COUNT_STATUS_ID);
        const forges = Number(existingCount?.data?.['count'] ?? 0) + 1;
        if (existingCount) ctx.removeStatus(ctx.sourceInstanceId, FORGE_COUNT_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: FORGE_COUNT_STATUS_ID,
          label: `Objets forgés (${forges})`,
          sourceCardInstanceId: ctx.sourceInstanceId,
          hidden: true, // compteur interne : le palier est déjà annoncé dans le journal
          data: { count: forges },
        });
        ctx.log(
          `Living Forge : forge réussie, "Récupération de matériaux" inflige désormais +${forges * FORGE_ATK_BONUS} dégâts`,
          { characterInstanceId: ctx.sourceInstanceId, forges }
        );

        // Seulement les cimetières d'Ornn lui-même : plus d'accès aux cimetières adverses.
        const player = ctx.state.players[ctx.ownerId];
        const candidates: RecoverableCard[] = [];
        for (const objectInstanceId of player.graveyardObjectInstanceIds) {
          const obj = player.objects[objectInstanceId];
          if (!obj) continue;
          candidates.push({ instanceId: objectInstanceId, cardId: obj.cardId, kind: 'object', name: getObjectCard(obj.cardId).name });
        }
        for (const terrainInstanceId of player.graveyardTerrainInstanceIds) {
          const terrain = player.terrains[terrainInstanceId];
          if (!terrain) continue;
          candidates.push({ instanceId: terrainInstanceId, cardId: terrain.cardId, kind: 'terrain', name: getTerrainCard(terrain.cardId).name });
        }
        if (candidates.length === 0) return;

        const chosenKey = await ctx.chooseOption(
          'Living Forge : choisissez la carte objet ou terrain à récupérer',
          // `card` : la modale affiche l'illustration réelle de chaque carte récupérable
          // plutôt qu'une simple ligne de texte.
          candidates.map((c) => ({
            key: c.instanceId,
            label: `${c.name} (${c.kind === 'object' ? 'objet' : 'terrain'})`,
            card: { cardId: c.cardId, kind: c.kind },
          }))
        );
        const chosen = candidates.find((c) => c.instanceId === chosenKey);
        if (!chosen) return;

        if (chosen.kind === 'object') {
          const idx = player.graveyardObjectInstanceIds.indexOf(chosen.instanceId);
          if (idx !== -1) player.graveyardObjectInstanceIds.splice(idx, 1);
          player.unplayedObjectInstanceIds.push(chosen.instanceId);
        } else {
          const idx = player.graveyardTerrainInstanceIds.indexOf(chosen.instanceId);
          if (idx !== -1) player.graveyardTerrainInstanceIds.splice(idx, 1);
          const terrain = player.terrains[chosen.instanceId]!;
          terrain.remainingTurns = undefined; // redéfini normalement à la prochaine pose
          terrain.data = undefined; // et sans l'état accumulé par sa vie précédente (marques, cibles suivies...)
          player.unplayedTerrainInstanceIds.push(chosen.instanceId);
        }

        ctx.log(`Living Forge : récupère ${chosen.name}`, {
          instanceId: chosen.instanceId,
          kind: chosen.kind,
        });
      },
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const char = findCharacter(ctx.state, ctx.sourceInstanceId);
        const record = getStatus(char, FORGE_COUNT_STATUS_ID);
        const forges = Number(record?.data?.['count'] ?? 0);
        return (current as number) + forges * FORGE_ATK_BONUS;
      },
    },
  ],
};
