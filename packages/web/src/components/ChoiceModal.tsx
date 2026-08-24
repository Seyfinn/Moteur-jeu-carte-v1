import { useEffect, useState } from 'react';
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

function SelectCharacters({
  state,
  spec,
  onAnswer,
}: {
  state: GameState;
  spec: Extract<PendingChoice['spec'], { kind: 'select-characters' }>;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const hover = useHoverCard();

  // Consecutive choices reuse this component instance, so the previous answer's
  // selection would otherwise carry over into the next prompt (and could contain ids
  // that aren't even offered any more).
  useEffect(() => setSelected([]), [spec]);

  function toggle(id: string) {
    if (spec.max === 1) {
      setSelected([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < spec.max ? [...prev, id] : prev));
  }

  return (
    <>
      <div className="modal-card-grid">
        {spec.options.map((id) => {
          const instance = findCharacterInstance(state, id);
          // A card can technically hand any instance id to a 'select-characters' choice.
          // Rendering nothing for the ones we can't resolve used to leave an empty modal
          // whose "Valider" button could never be enabled -- an unrecoverable game lock.
          // Show a plain selectable placeholder instead.
          if (!instance) {
            return (
              <button
                key={id}
                type="button"
                className={selected.includes(id) ? 'option-button selected' : 'option-button'}
                onClick={() => toggle(id)}
              >
                Carte inconnue
              </button>
            );
          }
          const name = cardName(instance.cardId);
          const currentHP = Math.max(0, instance.currentMaxHP - instance.damage);
          return (
            <CardFrame
              key={id}
              cardId={instance.cardId}
              kind="character"
              name={name}
              highlight={selected.includes(id)}
              onClick={() => toggle(id)}
              hoverProps={{
                onMouseEnter: (e) =>
                  hover.show(
                    {
                      title: name,
                      card: { cardId: instance.cardId, kind: 'character', name },
                      body: characterDetailBody(instance.cardId, instance),
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
          );
        })}
      </div>
      <button className="primary" disabled={selected.length < spec.min} onClick={() => onAnswer({ kind: 'select-characters', selected })}>
        Valider
      </button>
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
}: {
  spec: Extract<PendingChoice['spec'], { kind: 'select-option' }>;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
  const hover = useHoverCard();
  const cards = spec.options.filter((opt) => opt.card);

  if (cards.length === spec.options.length && cards.length > 0) {
    return (
      <div className="modal-card-grid">
        {spec.options.map((opt: ChoiceOption) => {
          const card = opt.card!;
          return (
            <CardFrame
              key={opt.key}
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
          );
        })}
      </div>
    );
  }

  return (
    <div className="modal-options">
      {spec.options.map((opt: ChoiceOption) => (
        <button key={opt.key} className="option-button" onClick={() => onAnswer({ kind: 'select-option', key: opt.key })}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function YesNo({ onAnswer }: { onAnswer: (answer: ChoiceAnswer) => void }) {
  return (
    <div className="modal-options">
      <button className="primary" onClick={() => onAnswer({ kind: 'yes-no', value: true })}>
        Oui
      </button>
      <button onClick={() => onAnswer({ kind: 'yes-no', value: false })}>Non</button>
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  const tmp = copy[i]!;
  copy[i] = copy[j]!;
  copy[j] = tmp;
  return copy;
}

function OrderChoice({
  spec,
  onAnswer,
}: {
  spec: Extract<PendingChoice['spec'], { kind: 'order' }>;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
  const [order, setOrder] = useState<string[]>(spec.items.map((i) => i.key));
  useEffect(() => setOrder(spec.items.map((i) => i.key)), [spec]);
  return (
    <>
      <ol className="order-list">
        {order.map((key, index) => {
          const item = spec.items.find((i) => i.key === key);
          return (
            <li key={key}>
              {item?.label ?? key}
              <span className="order-buttons">
                <button disabled={index === 0} onClick={() => setOrder(swap(order, index, index - 1))}>
                  ↑
                </button>
                <button disabled={index === order.length - 1} onClick={() => setOrder(swap(order, index, index + 1))}>
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <button className="primary" onClick={() => onAnswer({ kind: 'order', orderedKeys: order })}>
        Valider l'ordre
      </button>
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

/** The waiting player's version: just the seconds left before the prompt auto-resolves. */
export function ChoiceCountdownBadge({ deadline }: { deadline: number }) {
  const seconds = Math.ceil(useRemainingMs(deadline) / 1000);
  return <span className="waiting-countdown">{seconds > 0 ? `${seconds} s` : '…'}</span>;
}

/**
 * Counts down to the server's auto-answer deadline. An abandoned prompt would otherwise
 * freeze the match, so the server answers it with a neutral default -- showing the clock
 * makes that predictable instead of surprising.
 */
function ChoiceCountdown({ deadline }: { deadline: number }) {
  const seconds = Math.ceil(useRemainingMs(deadline) / 1000);
  return (
    <p className={seconds <= 15 ? 'modal-countdown urgent' : 'modal-countdown'}>
      {seconds > 0 ? `Réponse automatique dans ${seconds} s` : 'Réponse automatique…'}
    </p>
  );
}

export function ChoiceModal({
  state,
  choice,
  deadline,
  onAnswer,
}: {
  state: GameState;
  choice: PendingChoice;
  deadline: number | null;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
  const hover = useHoverCard();
  // Répondre fait disparaître la modale sous la souris : son `onMouseLeave` ne partira
  // jamais, donc l'aperçu au survol resterait planté sur le plateau.
  const answerAndClose = (answer: ChoiceAnswer) => {
    hover.hide();
    onAnswer(answer);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <p className="modal-prompt">{choice.spec.prompt}</p>
        {deadline !== null && <ChoiceCountdown deadline={deadline} />}
        {choice.spec.kind === 'select-characters' && <SelectCharacters state={state} spec={choice.spec} onAnswer={answerAndClose} />}
        {choice.spec.kind === 'select-option' && <SelectOption spec={choice.spec} onAnswer={answerAndClose} />}
        {choice.spec.kind === 'yes-no' && <YesNo onAnswer={answerAndClose} />}
        {choice.spec.kind === 'order' && <OrderChoice spec={choice.spec} onAnswer={answerAndClose} />}
      </div>
    </div>
  );
}
