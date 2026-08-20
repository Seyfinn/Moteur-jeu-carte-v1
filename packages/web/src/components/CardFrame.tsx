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
  footer,
  onClick,
  hoverProps,
}: {
  cardId: string;
  kind: 'character' | 'object' | 'terrain';
  name: string;
  size?: 'small' | 'normal' | 'large';
  highlight?: boolean;
  dimmed?: boolean;
  footer?: ReactNode;
  onClick?: () => void;
  hoverProps?: HoverHandlers;
}) {
  const classes = ['tcg-card', `tcg-card-${size}`];
  if (highlight) classes.push('highlight');
  if (dimmed) classes.push('dimmed');
  if (onClick) classes.push('clickable');

  return (
    <div className={classes.join(' ')} onClick={onClick} {...hoverProps}>
      <CardArt cardId={cardId} kind={kind} />
      <div className="tcg-card-name-banner">{name}</div>
      {footer && <div className="tcg-card-body">{footer}</div>}
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
