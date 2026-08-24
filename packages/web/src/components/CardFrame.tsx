import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
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
  /** `landscape` = illustration à gauche, nom et infos à droite -- le format du personnage actif. */
  orientation = 'portrait',
  highlight,
  dimmed,
  unique,
  footer,
  effects,
  onClick,
  hoverProps,
  title,
}: {
  cardId: string;
  kind: 'character' | 'object' | 'terrain';
  name: string;
  size?: 'small' | 'normal' | 'large';
  orientation?: 'portrait' | 'landscape';
  highlight?: boolean;
  dimmed?: boolean;
  /** Marks the card as limited to a single copy per deck (a small corner badge). */
  unique?: boolean;
  footer?: ReactNode;
  /** Absolutely-positioned overlay (status animations, damage flashes...) covering the whole card. */
  effects?: ReactNode;
  onClick?: () => void;
  hoverProps?: HoverHandlers;
  title?: string;
}) {
  const classes = ['tcg-card', `tcg-card-${size}`];
  if (orientation === 'landscape') classes.push('tcg-card-landscape');
  if (highlight) classes.push('highlight');
  if (dimmed) classes.push('dimmed');
  if (onClick) classes.push('clickable');

  // Une carte cliquable est un vrai bouton pour le clavier et les lecteurs d'écran :
  // jouer une carte, ouvrir sa fiche ou le mini-menu d'un banc passait par un `div`, donc
  // par la souris uniquement.
  const onKeyDown = onClick
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick();
      }
    : undefined;

  return (
    <div
      className={classes.join(' ')}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? name : undefined}
      title={title}
      {...hoverProps}
    >
      {unique && (
        <span className="tcg-card-unique-badge" title="Carte unique exemplaire (1 max par deck)">
          1×
        </span>
      )}
      <CardArt cardId={cardId} kind={kind} />
      {/* Une seule structure DOM pour les deux orientations : en portrait la CSS rend cette
          colonne transparente (`display: contents`), en paysage elle devient le panneau
          d'infos posé à droite de l'illustration. */}
      <div className="tcg-card-lane">
        <div className="tcg-card-name-banner">{name}</div>
        {footer && <div className="tcg-card-body">{footer}</div>}
      </div>
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
