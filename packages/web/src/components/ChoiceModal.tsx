import { useState } from 'react';
import { getCharacterCard, type ChoiceAnswer, type ChoiceOption, type CharacterInstance, type GameState, type PendingChoice } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody } from './cardDetails';

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
          if (!instance) return null;
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
                onMouseEnter: (e) => hover.show({ title: name, body: characterDetailBody(instance.cardId, instance) }, e.currentTarget),
                onMouseLeave: hover.hide,
              }}
              footer={
                <div className="hp-text">
                  {currentHP} / {instance.currentMaxHP} HP
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

function SelectOption({
  spec,
  onAnswer,
}: {
  spec: Extract<PendingChoice['spec'], { kind: 'select-option' }>;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
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

export function ChoiceModal({
  state,
  choice,
  onAnswer,
}: {
  state: GameState;
  choice: PendingChoice;
  onAnswer: (answer: ChoiceAnswer) => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <p className="modal-prompt">{choice.spec.prompt}</p>
        {choice.spec.kind === 'select-characters' && <SelectCharacters state={state} spec={choice.spec} onAnswer={onAnswer} />}
        {choice.spec.kind === 'select-option' && <SelectOption spec={choice.spec} onAnswer={onAnswer} />}
        {choice.spec.kind === 'yes-no' && <YesNo onAnswer={onAnswer} />}
        {choice.spec.kind === 'order' && <OrderChoice spec={choice.spec} onAnswer={onAnswer} />}
      </div>
    </div>
  );
}
