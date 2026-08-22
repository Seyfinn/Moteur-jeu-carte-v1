import { useEffect, useRef, useState } from 'react';
import { getCharacterCard, type CharacterInstance } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody } from './cardDetails';
import { StatusEffectLayers } from './statusEffects';
import { CharacterActionBadges } from './gameEventBadges';
import type { CharacterBadge } from './gameEvents';

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
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
  const currentHP = Math.max(0, char.currentMaxHP - char.damage);
  const pct = char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (currentHP / char.currentMaxHP) * 100)) : 0;
  const dead = currentHP <= 0;
  const name = cardName(char.cardId);

  const prevDamageRef = useRef(char.damage);
  const floaterSeqRef = useRef(0);
  const [flashing, setFlashing] = useState(false);
  const [floaters, setFloaters] = useState<DamageFloater[]>([]);

  useEffect(() => {
    const delta = char.damage - prevDamageRef.current;
    prevDamageRef.current = char.damage;
    if (delta <= 0) return;

    const id = ++floaterSeqRef.current;
    setFloaters((list) => [...list, { id, amount: delta }]);
    setFlashing(true);
    const flashTimer = setTimeout(() => setFlashing(false), 400);
    const floatTimer = setTimeout(() => setFloaters((list) => list.filter((f) => f.id !== id)), 1000);
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(floatTimer);
    };
  }, [char.damage]);

  return (
    <CardFrame
      cardId={char.cardId}
      kind="character"
      name={name}
      size={isActive ? 'large' : size}
      highlight={isActive}
      dimmed={dead && isKOable}
      hoverProps={{
        onMouseEnter: (e) => hover.show({ title: name, body: characterDetailBody(char.cardId, char) }, e.currentTarget),
        onMouseLeave: hover.hide,
      }}
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
            <div className="hp-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="hp-text">
            {currentHP} / {char.currentMaxHP} HP
            {char.shield > 0 && <span className="shield-text"> +{char.shield} 🛡</span>}
          </div>
          {char.statuses.length > 0 && (
            <div className="statuses">
              {char.statuses.map((s, i) => (
                <span key={i} className="status-badge" title={s.label}>
                  {s.statusId}
                  {s.remainingTurns !== undefined ? ` (${s.remainingTurns})` : ''}
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
