import { getCharacterCard, type CharacterInstance } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody } from './cardDetails';

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

export function CharacterCard({
  char,
  isActive,
  isKOable,
  size = 'normal',
}: {
  char: CharacterInstance;
  isActive: boolean;
  isKOable?: boolean;
  size?: 'small' | 'normal' | 'large';
}) {
  const hover = useHoverCard();
  const currentHP = Math.max(0, char.currentMaxHP - char.damage);
  const pct = char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (currentHP / char.currentMaxHP) * 100)) : 0;
  const dead = currentHP <= 0;
  const name = cardName(char.cardId);

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
      footer={
        <>
          <div className="hp-bar">
            <div className="hp-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="hp-text">
            {currentHP} / {char.currentMaxHP} HP
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
