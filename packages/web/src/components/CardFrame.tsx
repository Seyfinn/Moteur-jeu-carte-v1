import type { MouseEvent, ReactNode } from 'react';
import { CardArt } from './CardArt';

export interface HoverHandlers {
  onMouseEnter: (e: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

export function CardFrame({
  cardId,
  kind,
  name,
  size = 'normal',
  highlight,
  dimmed,
  unique,
  footer,
  effects,
  onClick,
  hoverProps,
}: {
  cardId: string;
  kind: 'character' | 'object' | 'terrain';
  name: string;
  size?: 'small' | 'normal' | 'large';
  highlight?: boolean;
  dimmed?: boolean;
  /** Marks the card as limited to a single copy per deck (a small corner badge). */
  unique?: boolean;
  footer?: ReactNode;
  /** Absolutely-positioned overlay (status animations, damage flashes...) covering the whole card. */
  effects?: ReactNode;
  onClick?: () => void;
  hoverProps?: HoverHandlers;
}) {
  const classes = ['tcg-card', `tcg-card-${size}`];
  if (highlight) classes.push('highlight');
  if (dimmed) classes.push('dimmed');
  if (onClick) classes.push('clickable');

  return (
    <div className={classes.join(' ')} onClick={onClick} {...hoverProps}>
      {unique && (
        <span className="tcg-card-unique-badge" title="Carte unique exemplaire (1 max par deck)">
          1×
        </span>
      )}
      <CardArt cardId={cardId} kind={kind} />
      <div className="tcg-card-name-banner">{name}</div>
      {footer && <div className="tcg-card-body">{footer}</div>}
      {effects}
    </div>
  );
}

export function FaceDownCard({ size = 'small' }: { size?: 'small' | 'normal' }) {
  return (
    <div className={`tcg-card tcg-card-${size} face-down`}>
      <div className="tcg-card-art">
        <span className="tcg-card-art-placeholder">🂠</span>
      </div>
    </div>
  );
}
