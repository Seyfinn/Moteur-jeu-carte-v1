import { useEffect, useRef, useState } from 'react';
import { getCharacterCard, type CharacterInstance, type StatusInstance } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody } from './cardDetails';
import { StatusEffectLayers } from './statusEffects';
import { CharacterActionBadges } from './gameEventBadges';
import type { CharacterBadge } from './gameEvents';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

/**
 * Statuses carry a human `label` written by the card that applied them ("Brûlure (La
 * flamme)"); the raw `statusId` is an internal key and reads as noise on the board, so
 * it moves to the tooltip instead.
 */
export function statusBadgeText(status: StatusInstance): string {
  const name = status.label || status.statusId;
  if (status.remainingTurns !== undefined) return `${name} (${status.remainingTurns})`;
  if (status.statusId === 'bleed') return `${name} x${Number(status.data?.['stacks'] ?? 1)}`;
  return name;
}

interface DamageFloater {
  id: number;
  amount: number;
}

export function CharacterCard({
  char,
  isActive,
  isKOable,
  size = 'normal',
  badges,
}: {
  char: CharacterInstance;
  isActive: boolean;
  isKOable?: boolean;
  size?: 'small' | 'normal' | 'large';
  badges?: CharacterBadge[];
}) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const currentHP = Math.max(0, char.currentMaxHP - char.damage);
  const pct = char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (currentHP / char.currentMaxHP) * 100)) : 0;
  const dead = currentHP <= 0;
  const name = cardName(char.cardId);

  const prevDamageRef = useRef(char.damage);
  const floaterSeqRef = useRef(0);
  const [flashing, setFlashing] = useState(false);
  const [floaters, setFloaters] = useState<DamageFloater[]>([]);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const delta = char.damage - prevDamageRef.current;
    prevDamageRef.current = char.damage;
    if (delta <= 0) return;

    const id = ++floaterSeqRef.current;
    setFloaters((list) => [...list, { id, amount: delta }]);
    setFlashing(true);
    // Timers are collected and cleared on unmount only. Clearing them in the effect's
    // own cleanup (i.e. on the *next* hit) cancelled the pending removal, so rapid
    // successive hits left their floaters stuck on the card forever.
    timersRef.current.push(
      setTimeout(() => setFlashing(false), 400),
      setTimeout(() => setFloaters((list) => list.filter((f) => f.id !== id)), 1000)
    );
  }, [char.damage]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return (
    <CardFrame
      cardId={char.cardId}
      kind="character"
      name={name}
      size={isActive ? 'large' : size}
      highlight={isActive}
      dimmed={dead && isKOable}
      onClick={coarse ? () => hover.showCentered({ title: name, body: characterDetailBody(char.cardId, char) }) : undefined}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: characterDetailBody(char.cardId, char) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
      effects={
        <>
          <StatusEffectLayers statusIds={char.statuses.map((s) => s.statusId)} />
          {char.shield > 0 && <div className="fx-layer fx-shield" />}
          {badges && <CharacterActionBadges badges={badges} />}
          {flashing && <div className="fx-damage-flash" />}
          {floaters.length > 0 && (
            <div className="fx-floaters">
              {floaters.map((f) => (
                <span key={f.id} className="fx-floater-number">
                  -{f.amount}
                </span>
              ))}
            </div>
          )}
        </>
      }
      footer={
        <>
          <div className="hp-bar">
            <div
              className={`hp-bar-fill${pct <= 25 ? ' low' : pct <= 50 ? ' mid' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="hp-text">
            {currentHP} / {char.currentMaxHP} HP
            {char.shield > 0 && <span className="shield-text"> +{char.shield} 🛡</span>}
          </div>
          {char.statuses.length > 0 && (
            <div className="statuses">
              {char.statuses.map((s, i) => (
                <span key={i} className="status-badge" title={`${s.label} (${s.statusId})`}>
                  {statusBadgeText(s)}
                </span>
              ))}
            </div>
          )}
          {char.attachedObjectInstanceIds.length > 0 && (
            <div className="attached-objects">{char.attachedObjectInstanceIds.length} objet(s) attaché(s)</div>
          )}
        </>
      }
    />
  );
}
