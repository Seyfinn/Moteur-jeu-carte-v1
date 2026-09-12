import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type RefObject } from 'react';
import { getCharacterCard, type ChoiceAnswer, type ChoiceOption, type CharacterInstance, type GameState, type PendingChoice } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';

function findCharacterInstance(state: GameState, instanceId: string): CharacterInstance | undefined {
  return state.players.p1.characters[instanceId] ?? state.players.p2.characters[instanceId];
}

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportement clavier d'une vraie boîte de dialogue : le focus arrive sur le premier
 * élément actionnable à l'ouverture, Tab tourne en rond à l'intérieur (le plateau derrière
 * est de toute façon injouable tant que la question est posée), et Échap vaut « annuler »
 * quand un refus est légal. Sans ça, le clavier partait se promener dans la main ou le
 * journal, sous le voile, et le joueur ne voyait plus où il était.
 */
export function useDialogFocus(ref: RefObject<HTMLElement>, onEscape?: () => void, resetKey?: unknown): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    // Le premier bouton ACTIF plutôt que le premier élément : dans une sélection de
    // cartes, « Valider » est encore grisé, et l'on veut donc atterrir sur la première
    // carte, pas sur un bouton qui ne répond pas.
    const first = root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !root.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !root.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Rendre le focus d'où il venait : sinon, une fois la modale refermée, il retombe
      // sur `body` et la prochaine tabulation repart du haut de la page.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // `resetKey` : deux questions qui s'enchaînent réutilisent la même modale, et le focus
    // doit repartir du premier bouton de la nouvelle, pas rester sur un reste de l'ancienne.
  }, [ref, onEscape, resetKey]);
}

/** « Choisis 1 personnage » / « Choisis de 1 à 3 personnages » : la contrainte en clair. */
export function selectionHint(min: number, max: number, noun: string): string {
  const plural = (n: number) => (n > 1 ? `${noun}s` : noun);
  if (min === max) return `Choisis ${min} ${plural(min)}`;
  if (min <= 0) return `Choisis jusqu'à ${max} ${plural(max)}`;
  return `Choisis de ${min} à ${max} ${plural(max)}`;
}

function SelectCharacters({
  state,
  spec,
  choiceId,
  onAnswer,
  hintId,
}: {
  state: GameState;
  spec: Extract<PendingChoice['spec'], { kind: 'select-characters' }>;
  /** Identité de la question : c'est elle (et non l'objet `spec`) qui remet la sélection à zéro. */
  choiceId: string;
  onAnswer: (answer: ChoiceAnswer) => void;
  hintId: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const hover = useHoverCard();

  // Consecutive choices reuse this component instance, so the previous answer's
  // selection would otherwise carry over into the next prompt (and could contain ids
  // that aren't even offered any more). Calé sur l'id du choix et non sur `spec` : chaque
  // rediffusion d'état (reconnexion de l'adversaire, par exemple) apporte un nouvel objet
  // `spec` pour la même question, et effaçait la sélection en cours sous la souris.
  useEffect(() => setSelected([]), [choiceId]);

  function toggle(id: string) {
    if (spec.max === 1) {
      setSelected([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < spec.max ? [...prev, id] : prev));
  }

  const enough = selected.length >= spec.min;
  const missing = spec.min - selected.length;

  return (
    <>
      <p className="modal-hint" id={hintId}>
        {selectionHint(spec.min, spec.max, 'personnage')}
        <span className={`modal-count${enough ? ' modal-count-ok' : ''}`} aria-live="polite">
          {selected.length}/{spec.max}
        </span>
      </p>
      <div className="modal-card-grid" role="group" aria-labelledby={hintId}>
        {spec.options.map((id, position) => {
          const instance = findCharacterInstance(state, id);
          const isSelected = selected.includes(id);
          // A card can technically hand any instance id to a 'select-characters' choice.
          // Rendering nothing for the ones we can't resolve used to leave an empty modal
          // whose "Valider" button could never be enabled -- an unrecoverable game lock.
          // Show a plain selectable placeholder instead.
          if (!instance) {
            return (
              <button
                key={id}
                type="button"
                className={isSelected ? 'option-button selected' : 'option-button'}
                aria-pressed={isSelected}
                onClick={() => toggle(id)}
              >
                Carte inconnue
              </button>
            );
          }
          const name = cardName(instance.cardId);
          const currentHP = Math.max(0, instance.currentMaxHP - instance.damage);
          const rank = selected.indexOf(id);
          return (
            // L'enveloppe porte le numéro d'ordre de sélection : `.tcg-card` est en
            // `overflow: hidden`, une pastille posée sur son coin y serait rognée.
            <div key={id} className={`modal-card-option${isSelected ? ' is-selected' : ''}`} style={{ '--i': position } as CSSProperties}>
              <CardFrame
                cardId={instance.cardId}
                kind="character"
                name={name}
                highlight={isSelected}
                onClick={() => toggle(id)}
                hoverProps={{
                  onMouseEnter: (e) =>
                    hover.show(
                      {
                        title: name,
                        card: { cardId: instance.cardId, kind: 'character', name },
                        body: characterDetailBody(instance.cardId, instance, state),
                      },
                      e.currentTarget
                    ),
                  onMouseLeave: hover.hide,
                }}
                footer={
                  <div className="hp-text">
                    {currentHP} / {instance.currentMaxHP} HP
                    {instance.shield > 0 && <span className="shield-text"> +{instance.shield} 🛡</span>}
                  </div>
                }
              />
              {isSelected && (
                <span className="modal-card-pick" aria-hidden="true">
                  {spec.max > 1 ? rank + 1 : '✓'}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="modal-footer">
        <button className="primary modal-confirm" disabled={!enough} onClick={() => onAnswer({ kind: 'select-characters', selected })}>
          {enough ? (spec.max > 1 ? `Valider (${selected.length}/${spec.max})` : 'Valider') : missing > 1 ? `Encore ${missing} à choisir` : 'Choisis une carte'}
        </button>
      </div>
    </>
  );
}

/** Corps de fiche correspondant au type de carte, pour l'aperçu au survol. */
function detailBodyFor(card: NonNullable<ChoiceOption['card']>) {
  if (card.kind === 'character') return characterDetailBody(card.cardId);
  if (card.kind === 'terrain') return terrainDetailBody(card.cardId);
  return objectDetailBody(card.cardId);
}

/**
 * Choisir « une option » recouvre deux cas très différents : une vraie alternative
 * abstraite (« vers l'actif » / « vers le banc »), qui reste un bouton de texte, et le
 * choix d'une carte précise (cimetière, réserve, deck) -- là, la carte porte un `card` et
 * on affiche l'illustration réelle, comme dans la sélection de personnages.
 */
function SelectOption({
  spec,
  onAnswer,
  hintId,
}: {
  spec: Extract<PendingChoice['spec'], { kind: 'select-option' }>;
  onAnswer: (answer: ChoiceAnswer) => void;
  hintId: string;
}) {
  const hover = useHoverCard();
  const cards = spec.options.filter((opt) => opt.card);

  if (cards.length === spec.options.length && cards.length > 0) {
    return (
      <>
        <p className="modal-hint" id={hintId}>
          Choisis 1 carte
          <span className="modal-hint-sub">un clic suffit</span>
        </p>
        <div className="modal-card-grid" role="group" aria-labelledby={hintId}>
          {spec.options.map((opt: ChoiceOption, position) => {
            const card = opt.card!;
            return (
              <div key={opt.key} className="modal-card-option" style={{ '--i': position } as CSSProperties}>
                <CardFrame
                  cardId={card.cardId}
                  kind={card.kind}
                  name={opt.label}
                  onClick={() => onAnswer({ kind: 'select-option', key: opt.key })}
                  hoverProps={{
                    onMouseEnter: (e) =>
                      hover.show(
                        {
                          title: opt.label,
                          card: { cardId: card.cardId, kind: card.kind, name: opt.label },
                          body: detailBodyFor(card),
                        },
                        e.currentTarget
                      ),
                    onMouseLeave: hover.hide,
                  }}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="modal-options" role="group" aria-labelledby={hintId}>
      <p className="modal-hint" id={hintId}>
        Choisis 1 option
      </p>
      {spec.options.map((opt: ChoiceOption) => (
        <button key={opt.key} className="option-button" onClick={() => onAnswer({ kind: 'select-option', key: opt.key })}>
          <span className="option-button-label">{opt.label}</span>
          <span className="option-button-arrow" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </div>
  );
}

function YesNo({ onAnswer }: { onAnswer: (answer: ChoiceAnswer) => void }) {
  return (
    <div className="modal-options modal-options-row">
      <button className="primary modal-yes" onClick={() => onAnswer({ kind: 'yes-no', value: true })}>
        Oui
      </button>
      <button className="modal-no" onClick={() => onAnswer({ kind: 'yes-no', value: false })}>
        Non
      </button>
    </div>
  );
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

/**
 * Ordre de résolution : une liste qu'on réordonne au choix à la souris (glisser-déposer
 * natif, sans bibliothèque) ou aux flèches. Les deux restent : le glisser est le geste
 * naturel, les flèches sont le seul chemin au clavier et sur écran tactile.
 */
function OrderChoice({
  spec,
  choiceId,
  onAnswer,
  hintId,
}: {
  spec: Extract<PendingChoice['spec'], { kind: 'order' }>;
  /** Même rôle que dans `SelectCharacters` : un ordre en cours ne repart de zéro que pour une NOUVELLE question. */
  choiceId: string;
  onAnswer: (answer: ChoiceAnswer) => void;
  hintId: string;
}) {
  const [order, setOrder] = useState<string[]>(spec.items.map((i) => i.key));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  useEffect(() => {
    setOrder(spec.items.map((i) => i.key));
    setDragIndex(null);
    setOverIndex(null);
    // `spec` n'est lu qu'à la remise à zéro : le lister ici referait partir l'ordre de zéro
    // à chaque rediffusion d'état pour la même question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceId]);

  const onDragStart = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox n'entame pas le glisser sans une donnée, n'importe laquelle.
    e.dataTransfer.setData('text/plain', String(index));
  };
  const onDragOver = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  };
  const onDrop = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragIndex !== null) setOrder(move(order, dragIndex, index));
    setDragIndex(null);
    setOverIndex(null);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <>
      <p className="modal-hint" id={hintId}>
        Du premier au dernier à se résoudre
        <span className="modal-hint-sub">glisse une ligne ou utilise les flèches</span>
      </p>
      <ol className="order-list" aria-labelledby={hintId}>
        {order.map((key, index) => {
          const item = spec.items.find((i) => i.key === key);
          const label = item?.label ?? key;
          const classes = ['order-item'];
          if (dragIndex === index) classes.push('is-dragging');
          if (overIndex === index && dragIndex !== null && dragIndex !== index) classes.push(dragIndex < index ? 'is-over-after' : 'is-over-before');
          return (
            <li
              key={key}
              className={classes.join(' ')}
              draggable
              onDragStart={onDragStart(index)}
              onDragOver={onDragOver(index)}
              onDrop={onDrop(index)}
              onDragEnd={onDragEnd}
            >
              <span className="order-handle" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="order-rank" aria-hidden="true">
                {index + 1}
              </span>
              <span className="order-label">{label}</span>
              <span className="order-buttons">
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Monter ${label}`}
                  title="Monter"
                  onClick={() => setOrder(move(order, index, index - 1))}
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={index === order.length - 1}
                  aria-label={`Descendre ${label}`}
                  title="Descendre"
                  onClick={() => setOrder(move(order, index, index + 1))}
                >
                  ▼
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="modal-footer">
        <button className="primary modal-confirm" onClick={() => onAnswer({ kind: 'order', orderedKeys: order })}>
          Valider l'ordre
        </button>
      </div>
    </>
  );
}

/** Shared clock so both the acting player and the one waiting see the same deadline. */
function useRemainingMs(deadline: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));
  useEffect(() => {
    setRemaining(Math.max(0, deadline - Date.now()));
    const timer = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return remaining;
}

/** En dessous, le compte à rebours cesse d'être discret. */
export const COUNTDOWN_URGENT_SECONDS = 15;

/** The waiting player's version: just the seconds left before the prompt auto-resolves. */
export function ChoiceCountdownBadge({ deadline }: { deadline: number }) {
  const seconds = Math.ceil(useRemainingMs(deadline) / 1000);
  return (
    <span className={`waiting-countdown${seconds <= COUNTDOWN_URGENT_SECONDS ? ' urgent' : ''}`} role="timer">
      {seconds > 0 ? `${seconds} s` : '…'}
    </span>
  );
}

/**
 * Counts down to the server's auto-answer deadline. An abandoned prompt would otherwise
 * freeze the match, so the server answers it with a neutral default -- showing the clock
 * makes that predictable instead of surprising.
 *
 * Discret tant qu'il reste du temps (une pastille dans le coin, une jauge qui se vide),
 * rouge et pulsant sous `COUNTDOWN_URGENT_SECONDS`. La jauge se calibre sur le temps
 * restant à l'ouverture : le client ne connaît pas la durée totale du serveur, et la
 * latence du réseau lui en mange déjà une fraction de seconde.
 */
function ChoiceCountdown({ deadline }: { deadline: number }) {
  const remaining = useRemainingMs(deadline);
  const total = useRef<number>(0);
  useEffect(() => {
    total.current = Math.max(1, deadline - Date.now());
  }, [deadline]);
  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= COUNTDOWN_URGENT_SECONDS;
  const ratio = total.current > 0 ? Math.min(1, remaining / total.current) : 1;
  return (
    <div
      className={urgent ? 'modal-countdown urgent' : 'modal-countdown'}
      role="timer"
      aria-live={urgent ? 'polite' : 'off'}
      title="Sans réponse, le serveur choisira pour toi"
    >
      <span className="modal-countdown-icon" aria-hidden="true">
        ⏱
      </span>
      <span className="modal-countdown-text">{seconds > 0 ? `${seconds} s` : 'Réponse auto…'}</span>
      <span className="modal-countdown-track" aria-hidden="true">
        <span className="modal-countdown-fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
    </div>
  );
}

export function ChoiceModal({
  state,
  choice,
  deadline,
  onAnswer,
  onCancel,
}: {
  state: GameState;
  choice: PendingChoice;
  deadline: number | null;
  onAnswer: (answer: ChoiceAnswer) => void;
  /** Un clic malheureux sur une attaque/ability : présent seulement quand `choice.cancellable`. */
  onCancel?: () => void;
}) {
  const hover = useHoverCard();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();
  useDialogFocus(dialogRef, onCancel, choice.id);
  // Répondre fait disparaître la modale sous la souris : son `onMouseLeave` ne partira
  // jamais, donc l'aperçu au survol resterait planté sur le plateau.
  const answerAndClose = (answer: ChoiceAnswer) => {
    hover.hide();
    onAnswer(answer);
  };
  return (
    <div className="modal-backdrop">
      <div
        className={`modal choice-modal choice-modal-${choice.spec.kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={choice.spec.kind === 'yes-no' ? undefined : hintId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 className="modal-prompt" id={titleId}>
            {choice.spec.prompt}
          </h2>
          {deadline !== null && <ChoiceCountdown deadline={deadline} />}
        </div>
        {choice.spec.kind === 'select-characters' && (
          <SelectCharacters state={state} spec={choice.spec} choiceId={choice.id} onAnswer={answerAndClose} hintId={hintId} />
        )}
        {choice.spec.kind === 'select-option' && <SelectOption spec={choice.spec} onAnswer={answerAndClose} hintId={hintId} />}
        {choice.spec.kind === 'yes-no' && <YesNo onAnswer={answerAndClose} />}
        {choice.spec.kind === 'order' && <OrderChoice spec={choice.spec} choiceId={choice.id} onAnswer={answerAndClose} hintId={hintId} />}
        {onCancel && (
          <button className="modal-cancel" onClick={onCancel}>
            Annuler cette action
            <kbd className="modal-kbd" aria-hidden="true">
              Échap
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
