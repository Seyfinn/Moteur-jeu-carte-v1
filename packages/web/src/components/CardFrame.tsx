import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
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
  className,
  rootRef,
  hideName,
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
  /**
   * Classes que l'appelant ajoute au cadre : mise en scène d'un impact, ambiance d'un
   * statut... Elles doivent porter sur la CARTE elle-même (son illustration, sa position),
   * ce qu'un calque d'effet posé par-dessus ne peut pas faire.
   */
  className?: string;
  /** Accès au cadre pour en relever la position (cf. `cardRects.ts`). */
  rootRef?: Ref<HTMLDivElement>;
  /**
   * Retire le bandeau de nom. Réservé au personnage actif, dont le nom est repris par le
   * bandeau de combat posé au-dessus de la carte -- l'afficher deux fois volerait de la
   * place à l'illustration, qui est justement ce que ce format met en avant.
   */
  hideName?: boolean;
}) {
  const classes = ['tcg-card', `tcg-card-${size}`];
  if (orientation === 'landscape') classes.push('tcg-card-landscape');
  if (highlight) classes.push('highlight');
  if (dimmed) classes.push('dimmed');
  if (onClick) classes.push('clickable');
  if (targetable) classes.push('targetable');
  if (targeted) classes.push('targeted');
  if (className) classes.push(className);

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
      ref={rootRef}
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
        {!hideName && <div className="tcg-card-name-banner">{name}</div>}
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
