import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { getObjectCard } from 'engine';
import { CardArt } from './CardArt';

/**
 * Un objet « à lier » se reconnaît d'un coup d'œil, partout où sa carte est affichée
 * (main, cimetière, deck-builder, aperçu, mise en avant...) : le logo est dérivé du
 * registre plutôt que passé en prop par chaque appelant, pour qu'aucune surface ne puisse
 * l'oublier. Carte inconnue du registre = pas de logo, jamais d'erreur.
 */
export function isEquipmentCard(cardId: string, kind: 'character' | 'object' | 'terrain'): boolean {
  if (kind !== 'object') return false;
  try {
    return getObjectCard(cardId).equipment === true;
  } catch {
    return false;
  }
}

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
  targetable,
  targeted,
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
  /** Cible légale du ciblage en cours : halo vert et curseur de visée. */
  targetable?: boolean;
  /** Déjà retenue dans le ciblage en cours (en attente de validation). */
  targeted?: boolean;
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
  if (targetable) classes.push('targetable');
  if (targeted) classes.push('targeted');

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
      {(unique || isEquipmentCard(cardId, kind)) && (
        <span className="tcg-card-badges">
          {isEquipmentCard(cardId, kind) && (
            <span className="tcg-card-equip-badge" title="Équipement : se lie à un personnage et le suit jusqu'à sa mort">
              🔗
            </span>
          )}
          {unique && (
            <span className="tcg-card-unique-badge" title="Carte unique exemplaire (1 max par deck)">
              1×
            </span>
          )}
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
