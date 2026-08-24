import type { CharacterCardDef } from '../types.js';
import { getCharacterCard } from '../registry.js';
import { getStatus } from '../../statuses.js';

const RAIKIRI_ATK = 60;

const LAST_ENEMY_ATTACK_STATUS_ID = 'kakashi-last-enemy-attack';
const SHARINGAN_EVASION_PERCENT = 33;

export const kakashi: CharacterCardDef = {
  type: 'character',
  id: 'kakashi',
  name: 'Kakashi',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'raikiri',
      name: 'Raikiri',
      baseATK: RAIKIRI_ATK,
      description: `Inflige ${RAIKIRI_ATK} dégâts à l'actif adverse.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, RAIKIRI_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'sharingan',
      name: 'Sharingan',
      kind: 'passive',
      description:
        "Kakashi bénéficie en permanence de l'effet Esquive (statut 'evasive', 33% au lieu de 5% de base), que Kakashi soit actif ou au banc.",
      // Purement descriptive : implémentée par le modifier 'getEvasionPercent' plus bas
      // (même mécanisme que L'Infini de Gojo).
      async execute() {},
    },
    {
      // Bookkeeping pur : mémorise la dernière attaque de l'ennemi pour Copie de
      // Technique ci-dessous. Miroir exact du tracker de Spell Thief (zoe.ts), mais sur
      // onAttackDeclared plutôt que onAbilityUsed.
      id: 'copie-de-technique-tracker',
      name: 'Copie de Technique (mémoire)',
      kind: 'passive',
      description: "Retient la dernière attaque utilisée par l'ennemi, pour Copie de Technique.",
      trigger: 'onAttackDeclared',
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        const data = ctx.event!.data as { characterInstanceId: string; attackId: string };
        ctx.removeStatus(ctx.sourceInstanceId, LAST_ENEMY_ATTACK_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: LAST_ENEMY_ATTACK_STATUS_ID,
          label: 'Copie de Technique (mémoire)',
          hidden: true, // mémoire interne, aucune information utile à afficher sur la carte
          data: { characterInstanceId: data.characterInstanceId, attackId: data.attackId },
        });
      },
    },
    {
      id: 'copie-de-technique',
      name: 'Copie de Technique',
      kind: 'active',
      description:
        "Rejoue immédiatement la dernière attaque utilisée par l'adversaire, mais lancée par Kakashi. Une attaque qui dépend d'un compteur propre à son porteur d'origine peut être moins efficace. Utilisation unique.",
      usesPerGame: 1,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        return !!getStatus(self, LAST_ENEMY_ATTACK_STATUS_ID);
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const record = getStatus(self, LAST_ENEMY_ATTACK_STATUS_ID);
        const characterInstanceId = record?.data?.['characterInstanceId'] as string | undefined;
        const attackId = record?.data?.['attackId'] as string | undefined;
        if (!characterInstanceId || !attackId) return;

        const stolenCardId = ctx.getCharacter(characterInstanceId).cardId;
        const stolenAttack = getCharacterCard(stolenCardId).attacks.find((a) => a.id === attackId);
        if (!stolenAttack) return; // plus disponible (ex: le personnage d'origine a changé de forme depuis)

        ctx.log(`Copie de Technique : Kakashi utilise ${stolenAttack.name}`, { attackId, stolenFrom: characterInstanceId });
        await stolenAttack.execute(ctx);
      },
    },
  ],
  modifiers: [
    {
      // "Sharingan" : esquive innée permanente, actif ou au banc.
      query: 'getEvasionPercent',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, SHARINGAN_EVASION_PERCENT);
      },
    },
  ],
};
