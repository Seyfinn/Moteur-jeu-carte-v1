import type { CharacterCardDef } from '../types.js';
import { getObjectCard } from '../registry.js';
import { getStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';
import { randomInt } from '../../rng.js';

const CHAINSAW_ATK = 50;
const BLEED_STACKS = 2;

const MANGEUR_DE_DEMONS_ABILITY_ID = 'mangeur-de-demons';
const DEVOURED_COUNT_STATUS_ID = 'chainsaw-man-devoured-count';

export const chainsawMan: CharacterCardDef = {
  type: 'character',
  id: 'chainsaw-man',
  name: 'Chainsaw Man',
  baseMaxHP: 280,
  attacks: [
    {
      id: 'chainsaw',
      name: 'Chainsaw',
      baseATK: CHAINSAW_ATK,
      description: 'Applique 2 bleed.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Un seul jet d'esquive partagé entre les dégâts et le bleed (même pattern que
        // Lacération de Sukuna / La Flamme de Rengoku) : pas de "%" annoncé sur la carte,
        // donc le bleed n'est pas une chance séparée -- soit l'attaque touche et les deux
        // s'appliquent, soit elle est esquivée et rien ne se passe.
        if (ctx.rollEvasion(target.instanceId)) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CHAINSAW_ATK);
        await ctx.dealDamage(target.instanceId, atk, { skipEvasionRoll: true });
        ctx.applyStatus(
          target.instanceId,
          {
            statusId: 'bleed',
            label: 'Bleed (Chainsaw)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { stacks: BLEED_STACKS },
          },
          { skipEvasionRoll: true }
        );
      },
    },
  ],
  abilities: [
    {
      id: MANGEUR_DE_DEMONS_ABILITY_ID,
      name: 'Mangeur de démons',
      kind: 'active',
      description:
        "Supprime une carte objet aléatoire de l'ennemi. Utilisable 1 fois et 1 fois de plus par personnage " +
        'tué par Chainsaw Man.',
      // Déclaré à 1 : le modifier getAbilityUsesPerGame ci-dessous ajoute +1 par kill
      // enregistré dans le compteur permanent (voir "dévoreur" plus bas).
      usesPerGame: 1,
      condition(ctx) {
        return ctx.state.players[ctx.opponentId].unplayedObjectInstanceIds.length > 0;
      },
      async execute(ctx) {
        const enemy = ctx.state.players[ctx.opponentId];
        const pool = enemy.unplayedObjectInstanceIds;
        if (pool.length === 0) return;

        const idx = randomInt(ctx.state.rng, pool.length);
        const removedId = pool[idx]!;
        pool.splice(idx, 1);
        enemy.graveyardObjectInstanceIds.push(removedId);

        const removedCardId = enemy.objects[removedId]!.cardId;
        ctx.log(`Mangeur de démons : dévore ${getObjectCard(removedCardId).name} dans la réserve adverse`, {
          objectInstanceId: removedId,
        });
      },
    },
    {
      // Bookkeeping pur : compte les kills attribués à Chainsaw Man pour faire monter le
      // plafond d'utilisations de Mangeur de démons ci-dessus -- même pattern que le
      // compteur permanent de Berserk (guts.ts) et l'amélioration au kill d'Execution
      // (caitlyn.ts), mais ici en second AbilityDef séparé puisque Mangeur de démons est
      // une capacité active (donc sans `trigger`, sinon elle ne serait plus activable
      // manuellement -- voir CLAUDE.md) alors que le comptage réagit à onCharacterKO.
      //
      // ⚠️ N'attrape que les kills où Chainsaw Man est le tueur DIRECT (attribution portée
      // par ctx.dealDamage). Un ennemi achevé par le tick du bleed posé ici ne compte PAS :
      // les tics de statuts (poison/burn/bleed) infligent leurs dégâts sans attributionId
      // de tueur (voir tickStatusesAtTurnStart, statuses.ts) -- angle mort assumé, cohérent
      // avec le reste du moteur (même limite documentée pour "sur kill" dans CLAUDE.md).
      id: 'devoreur-compteur',
      name: 'Dévoreur (compteur)',
      kind: 'passive',
      description: 'Compte les personnages tués par Chainsaw Man, pour Mangeur de démons.',
      trigger: 'onCharacterKO',
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.data['killerInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const existing = getStatus(self, DEVOURED_COUNT_STATUS_ID);
        const count = Number(existing?.data?.['count'] ?? 0) + 1;
        if (existing) ctx.removeStatus(ctx.sourceInstanceId, DEVOURED_COUNT_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: DEVOURED_COUNT_STATUS_ID,
          label: 'Dévoreur (compteur)',
          hidden: true, // compteur interne, aucune info utile à afficher sur la carte
          data: { count },
        });
        ctx.log(`Mangeur de démons : utilisation supplémentaire débloquée (${count} au total)`, {
          characterInstanceId: ctx.sourceInstanceId,
        });
      },
    },
  ],
  modifiers: [
    {
      query: 'getAbilityUsesPerGame',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        if (ctx.query['abilityId'] !== MANGEUR_DE_DEMONS_ABILITY_ID) return current;
        const self = findCharacter(ctx.state, ctx.sourceInstanceId);
        const record = getStatus(self, DEVOURED_COUNT_STATUS_ID);
        const kills = Number(record?.data?.['count'] ?? 0);
        return Number(current ?? 1) + kills;
      },
    },
  ],
};
