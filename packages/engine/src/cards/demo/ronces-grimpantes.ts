import type { EffectContext, TerrainCardDef } from '../types.js';
import type { PlayerId } from '../../types.js';

const DURATION_TURNS = 5;
/** « augmente de 10% les dégâts subis à chaque tour ». */
const DAMAGE_BONUS_PERCENT_PER_TURN = 10;

/**
 * L'emprise des ronces sur le poste actif d'un camp. Statut privé de la carte -- il n'a
 * de sens que pour elle -- et **seule** source de vérité du compteur : le porter sur le
 * personnage plutôt que dans le `data` du terrain donne au joueur le badge qui dit où il
 * en est, et rend impossible une désynchronisation entre l'affichage et le multiplicateur.
 *
 * `data.turns` = nombre de tours déjà passés au poste actif (0 = premier tour, 0 % de plus).
 * `data.armed` = le premier tour a déjà commencé, donc le prochain début de tour compte.
 */
const STATUS_ID = 'ronces-grimpantes-emprise';

interface Stack {
  turns: number;
  armed: boolean;
}

function stackOn(ctx: EffectContext, characterInstanceId: string): Stack | undefined {
  const status = ctx.getCharacter(characterInstanceId).statuses.find((s) => s.statusId === STATUS_ID);
  if (!status) return undefined;
  return { turns: Number(status.data?.['turns'] ?? 0), armed: status.data?.['armed'] === true };
}

/**
 * Repose le compteur de ce camp sur son actif du moment, en nettoyant au passage tout le
 * reste de son plateau : le balayage garantit qu'un seul personnage par camp porte le
 * badge, donc qu'un personnage renvoyé au banc n'en garde pas un périmé.
 */
function setStack(ctx: EffectContext, playerId: PlayerId, stack: Stack): void {
  for (const char of ctx.getAllOnBoard(playerId)) ctx.removeStatus(char.instanceId, STATUS_ID);
  const active = ctx.getActive(playerId);
  if (!active) return;
  const percent = stack.turns * DAMAGE_BONUS_PERCENT_PER_TURN;
  ctx.applyStatus(
    active.instanceId,
    {
      statusId: STATUS_ID,
      label: `Ronces grimpantes (+${percent} % de dégâts subis)`,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { turns: stack.turns, armed: stack.armed },
    },
    // Le terrain frappe les deux camps ; sans ça, l'actif d'en face pourrait « esquiver »
    // le compteur, qui n'est pas une attaque mais de la comptabilité affichée.
    { skipEvasionRoll: true }
  );
}

/**
 * Le tour en cours compte-t-il déjà comme le « premier tour » de ce camp sous les ronces ?
 * Oui pour celui qui est en train de jouer (il a du temps devant lui), non pour l'autre,
 * dont le début de tour n'est pas encore passé. Les deux camps ont ainsi exactement un
 * tour complet à 0 % avant de passer à 10 %.
 */
function armedNow(ctx: EffectContext, playerId: PlayerId): boolean {
  return ctx.state.activePlayerId === playerId;
}

export const roncesGrimpantes: TerrainCardDef = {
  type: 'terrain',
  id: 'ronces-grimpantes',
  name: 'Ronces grimpantes',
  description: `Tous les personnages actifs subissent de plus en plus de dégâts en fonction du temps qu'ils restent au poste actif.
Premier tour 0% de dégâts prit en plus, ensuite, augmente de ${DAMAGE_BONUS_PERCENT_PER_TURN}% les dégâts subis à chaque tour (Tour 2 = ${DAMAGE_BONUS_PERCENT_PER_TURN}%, tour 3 = ${DAMAGE_BONUS_PERCENT_PER_TURN * 2}%) tant que le personnage actif reste sur le poste actif.
Se réinitialise si il y a un switch où si le personnage actif meurt, seulement pour le joueur concerné.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'ronces-grimpantes-pose',
      name: 'Prise de racine',
      kind: 'passive',
      description: 'À la pose, les deux camps repartent de zéro, quel que soit le temps déjà passé au poste actif.',
      trigger: 'onTerrainPlayed',
      // Pour CE terrain seulement : l'event part pour n'importe quelle pose, celle de
      // l'adversaire comprise (cf. CLAUDE.md).
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          setStack(ctx, playerId, { turns: 0, armed: armedNow(ctx, playerId) });
        }
      },
    },
    {
      id: 'ronces-grimpantes-reset',
      name: 'Réinitialisation',
      kind: 'passive',
      description:
        "Un nouvel arrivant au poste actif repart à 0 %, qu'il vienne d'un switch, d'une carte qui l'a poussé ou du remplacement d'un mort.",
      // `onBecomeActive` couvre les trois chemins d'un seul coup : switch volontaire,
      // switch forcé par une carte, et remplacement après un KO (qui n'est pas un switch
      // et n'émet donc pas `onSwitch`).
      trigger: 'onBecomeActive',
      async execute(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return;
        setStack(ctx, playerId, { turns: 0, armed: armedNow(ctx, playerId) });
      },
    },
    {
      id: 'ronces-grimpantes-serrage',
      name: 'Les ronces se resserrent',
      kind: 'passive',
      description: `Au début de chaque tour, l'actif qui n'a pas bougé prend ${DAMAGE_BONUS_PERCENT_PER_TURN} % de plus.`,
      trigger: 'onTurnStart',
      async execute(ctx) {
        const playerId = ctx.event?.playerId;
        if (!playerId) return;
        const active = ctx.getActive(playerId);
        if (!active) return;
        const stack = stackOn(ctx, active.instanceId);
        // Pas encore de compteur sur cet actif (filet de sécurité : `onBecomeActive` et la
        // pose en posent normalement un) : ce tour-ci est son premier, donc 0 %.
        if (!stack) {
          setStack(ctx, playerId, { turns: 0, armed: true });
          return;
        }
        // « Premier tour 0% de dégâts prit en plus » : le tour qui l'a vu arriver ne compte
        // pas, c'est celui d'après qui fait monter la première dîme.
        if (!stack.armed) {
          setStack(ctx, playerId, { turns: stack.turns, armed: true });
          return;
        }
        setStack(ctx, playerId, { turns: stack.turns + 1, armed: true });
      },
    },
    {
      id: 'ronces-grimpantes-fin',
      name: 'Fin des ronces',
      kind: 'passive',
      description: 'Les compteurs disparaissent avec le terrain.',
      // Le terrain peut partir autrement que par son décompte (détruit, remplacé) : sans
      // ce nettoyage, le badge resterait collé aux personnages pour toute la partie
      // (cf. CLAUDE.md, le bug d'Absorption Vitale).
      trigger: 'onTerrainRemoved',
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          for (const char of ctx.getAllOnBoard(playerId)) ctx.removeStatus(char.instanceId, STATUS_ID);
        }
      },
    },
  ],
  modifiers: [
    {
      // Tous les dégâts subis, sans distinction de source : attaques, capacités, effets de
      // terrain, tics de poison/brûlure/saignement. Seul un coût en HP qu'un camp se paie à
      // lui-même y échappe -- il passe par `ignoreDamageReduction`, qui court-circuite
      // cette requête, exactement comme pour le statut `vulnérable`.
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          const player = ctx.state.players[playerId];
          // « Tous les personnages ACTIFS » : le banc ne prend rien de plus, même s'il
          // traîne encore un badge d'un passage précédent au poste actif.
          if (player.activeCharacterInstanceId !== targetInstanceId) continue;
          const status = player.characters[targetInstanceId]?.statuses.find((s) => s.statusId === STATUS_ID);
          const turns = Number(status?.data?.['turns'] ?? 0);
          if (turns <= 0) return current;
          return Math.round((current as number) * (1 + (turns * DAMAGE_BONUS_PERCENT_PER_TURN) / 100));
        }
        return current;
      },
    },
  ],
};
