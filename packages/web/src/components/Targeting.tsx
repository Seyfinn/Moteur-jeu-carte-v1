import { useEffect, useMemo, useState } from 'react';
import { getCharacterCard, type GameState, type PendingChoice, type PlayerId } from 'engine';
import { ChoiceCountdownBadge } from './ChoiceModal';

/**
 * Ciblage sur le plateau : quand le moteur demande de désigner des personnages, on ne
 * sort pas une liste par-dessus la table -- on allume les cartes visées là où elles sont,
 * le joueur clique dessus, puis valide.
 *
 * Repli sur la modale (`ChoiceModal`) dès qu'une des options n'est **pas** posée sur le
 * plateau : c'est le cas du choix de l'actif de départ, où les personnages ne sont encore
 * ni actifs ni au banc. Sans ce repli, la modale disparaîtrait sans que rien ne soit
 * cliquable et la partie serait bloquée jusqu'au minuteur du serveur.
 */
export interface BoardTargeting {
  choiceId: string;
  prompt: string;
  min: number;
  max: number;
  /** Instances désignables, telles que le moteur les a proposées. */
  options: ReadonlySet<string>;
  selected: string[];
  /** Clic sur une carte : retient la cible, ou la retire si elle l'était déjà. */
  toggle(instanceId: string): void;
  clear(): void;
  confirm(): void;
}

function boardInstanceIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const player = state.players[playerId];
    if (player.activeCharacterInstanceId) ids.add(player.activeCharacterInstanceId);
    for (const id of player.benchCharacterInstanceIds) ids.add(id);
  }
  return ids;
}

export function useBoardTargeting(
  state: GameState,
  you: PlayerId,
  pendingChoice: PendingChoice | undefined,
  answer: (choiceId: string, selected: string[]) => void
): BoardTargeting | null {
  const [selected, setSelected] = useState<string[]>([]);
  const choiceId = pendingChoice?.id;

  // Deux choix qui s'enchaînent réutilisent ce composant : sans ce reset, la sélection du
  // précédent (des instances que le nouveau ne propose peut-être même pas) serait déjà là.
  useEffect(() => setSelected([]), [choiceId]);

  const spec = pendingChoice?.playerId === you && pendingChoice.spec.kind === 'select-characters' ? pendingChoice.spec : null;

  const options = useMemo(() => (spec ? new Set(spec.options) : null), [spec]);

  if (!spec || !options || !choiceId) return null;
  const onBoard = boardInstanceIds(state);
  if (spec.options.length === 0 || !spec.options.every((id) => onBoard.has(id))) return null;

  const toggle = (instanceId: string) => {
    if (!options.has(instanceId)) return;
    setSelected((prev) => {
      if (prev.includes(instanceId)) return prev.filter((id) => id !== instanceId);
      // Cible unique : cliquer ailleurs déplace la visée au lieu de ne rien faire une fois
      // le quota atteint.
      if (spec.max === 1) return [instanceId];
      return prev.length < spec.max ? [...prev, instanceId] : prev;
    });
  };

  return {
    choiceId,
    prompt: spec.prompt,
    min: spec.min,
    max: spec.max,
    options,
    // La sélection est filtrée à la volée : un personnage retenu puis tué par un effet qui
    // se résout entre-temps ne doit pas partir dans la réponse.
    selected: selected.filter((id) => options.has(id) && onBoard.has(id)),
    toggle,
    clear: () => setSelected([]),
    confirm: () => answer(choiceId, selected.filter((id) => options.has(id))),
  };
}

function nameOf(state: GameState, instanceId: string): string {
  const char = state.players.p1.characters[instanceId] ?? state.players.p2.characters[instanceId];
  if (!char) return '?';
  try {
    return getCharacterCard(char.cardId).name;
  } catch {
    return char.cardId;
  }
}

/**
 * Barre de validation du ciblage. Elle vit en bas de l'écran, par-dessus la main (de toute
 * façon injouable tant qu'un choix est en cours) : le plateau reste entièrement visible,
 * contrairement à la modale qu'elle remplace.
 *
 * Le clic ne vaut jamais réponse à lui seul -- il faut valider. C'est ce qui protège du
 * clic malheureux sur une carte voisine.
 */
export function TargetingBar({
  targeting,
  state,
  deadline,
}: {
  targeting: BoardTargeting;
  state: GameState;
  deadline: number | null;
}) {
  const { selected, min, max } = targeting;
  const enough = selected.length >= min;
  const names = selected.map((id) => nameOf(state, id));

  return (
    <div className="targeting-bar" role="dialog" aria-label="Ciblage">
      <div className="targeting-bar-head">
        <span className="targeting-bar-prompt">{targeting.prompt}</span>
        {deadline !== null && <ChoiceCountdownBadge deadline={deadline} />}
      </div>

      <p className="targeting-bar-status">
        {selected.length === 0 ? (
          <>
            Cliquez {max > 1 ? `jusqu'à ${max} cartes` : 'une carte'} en surbrillance sur le plateau
            {min > 1 && ` (${min} minimum)`}.
          </>
        ) : (
          <>
            Valider ce choix ? <strong>{names.join(', ')}</strong>
            {max > 1 && (
              <span className="targeting-bar-count">
                {' '}
                — {selected.length}/{max}
              </span>
            )}
          </>
        )}
      </p>

      <div className="targeting-bar-actions">
        <button className="primary" disabled={!enough} onClick={targeting.confirm}>
          Valider ce choix
        </button>
        <button onClick={targeting.clear} disabled={selected.length === 0}>
          Annuler
        </button>
      </div>
    </div>
  );
}
