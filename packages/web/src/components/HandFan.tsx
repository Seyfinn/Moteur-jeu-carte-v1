import type { CSSProperties } from 'react';
import type { GameState, PlayerId, PlayerState } from 'engine';
import { CardFrame, FaceDownCard } from './CardFrame';
import { useCardInspect, useHoverCard, type HoverPayload } from './HoverCard';
import { hiddenCardDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import { objectCardDenial, objectName, terrainName } from './boardActions';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

export type HandSlot =
  | { kind: 'object'; id: string; cardId: string }
  | { kind: 'terrain'; id: string; cardId: string }
  | { kind: 'hidden'; id: string };

/**
 * L'identité d'une carte n'est lisible que si l'état reçu porte réellement son instance :
 * toujours vrai pour notre propre main, et pour celle de l'adversaire une fois révélée
 * (« Ultimate Détective » de Kirigiri). Sinon `getPlayerView` l'a réduite à un id
 * placeholder impossible à résoudre -- c'est le dos de carte.
 */
export function handSlots(player: PlayerState): HandSlot[] {
  return [
    ...player.unplayedObjectInstanceIds.map((id): HandSlot => {
      const obj = player.objects[id];
      return obj ? { kind: 'object', id, cardId: obj.cardId } : { kind: 'hidden', id };
    }),
    ...player.unplayedTerrainInstanceIds.map((id): HandSlot => {
      const terrain = player.terrains[id];
      return terrain ? { kind: 'terrain', id, cardId: terrain.cardId } : { kind: 'hidden', id };
    }),
  ];
}

/**
 * Éventail « façon Slay the Spire ». Rotation, retombée et ordre d'empilement partent tous
 * les trois en variables CSS, jamais en `transform` / `zIndex` posés en ligne : un style en
 * ligne gagne sur toute règle de feuille de style, et la carte survolée ne pourrait plus se
 * redresser, grandir, ni passer devant ses voisines.
 */
function fanStyle(index: number, count: number): CSSProperties {
  const offset = index - (count - 1) / 2;
  const step = count > 1 ? Math.min(6, 52 / count) : 0;
  const lift = offset * offset * (count > 8 ? 1 : 1.7);
  return {
    '--fan-rot': `${(offset * step).toFixed(2)}deg`,
    '--fan-lift': `${lift.toFixed(1)}px`,
    '--fan-z': index + 1,
  } as CSSProperties;
}

function PlayerHandCard({
  slot,
  index,
  count,
  disabledReason,
  onPlay,
  onBlocked,
}: {
  slot: Extract<HandSlot, { kind: 'object' | 'terrain' }>;
  index: number;
  count: number;
  disabledReason: string | null;
  onPlay: () => void;
  onBlocked: (reason: string) => void;
}) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const isObject = slot.kind === 'object';
  const name = isObject ? objectName(slot.cardId) : terrainName(slot.cardId);
  const verb = isObject ? 'Jouer' : 'Poser';

  const payload: HoverPayload = {
    title: name,
    subtitle: disabledReason ?? undefined,
    card: { cardId: slot.cardId, kind: slot.kind, name },
    body: isObject ? objectDetailBody(slot.cardId) : terrainDetailBody(slot.cardId),
    actionLabel: disabledReason ? undefined : verb,
    onAction: onPlay,
  };

  // Au doigt il n'y a pas de survol pour lire la carte avant de la jouer : le tap ouvre
  // la fiche en grand, qui porte elle-même le bouton « Jouer ». À la souris, le survol
  // affiche déjà la fiche, donc le clic joue directement.
  const handleClick = () => {
    if (coarse) {
      hover.showCentered(payload);
      return;
    }
    if (disabledReason) {
      onBlocked(disabledReason);
      return;
    }
    onPlay();
  };

  return (
    <div className={`hand-card${disabledReason ? ' blocked' : ''}`} style={fanStyle(index, count)}>
      <CardFrame
        cardId={slot.cardId}
        kind={slot.kind}
        name={name}
        size="normal"
        // Au doigt, la carte reste en pleine couleur même injouable : le tap sert d'abord à
        // la lire, et le libellé « Indisponible » dit déjà qu'elle ne partira pas.
        dimmed={Boolean(disabledReason) && !coarse}
        onClick={handleClick}
        title={disabledReason ?? undefined}
        hoverProps={
          coarse
            ? undefined
            : {
                onMouseEnter: (e) => hover.show(payload, e.currentTarget),
                onMouseLeave: hover.hide,
              }
        }
        footer={<span className={`hand-card-hint${disabledReason ? ' blocked' : ''}`}>{disabledReason ? 'Indisponible' : verb}</span>}
      />
    </div>
  );
}

/** La main du joueur, en éventail tout en bas de l'écran. */
export function PlayerHand({
  state,
  you,
  player,
  objectDenial,
  terrainDenial,
  onPlayObject,
  onPlayTerrain,
  onBlocked,
}: {
  state: GameState;
  you: PlayerId;
  player: PlayerState;
  objectDenial: string | null;
  terrainDenial: string | null;
  onPlayObject: (instanceId: string) => void;
  onPlayTerrain: (instanceId: string) => void;
  onBlocked: (reason: string) => void;
}) {
  const slots = handSlots(player);

  // Le refus global (pas votre tour, quota d'objets épuisé) prime : il empêche de jouer
  // quoi que ce soit. Sinon, la carte affiche sa propre raison de ne rien pouvoir cibler.
  const denialFor = (slot: HandSlot): string | null => {
    if (slot.kind === 'terrain') return terrainDenial;
    if (slot.kind === 'hidden') return null;
    return objectDenial ?? objectCardDenial(state, you, slot.id);
  };

  return (
    <div className="hand-fan" role="group" aria-label="Votre main">
      {slots.length === 0 && <span className="hand-strip-empty">Main vide</span>}
      {slots.map((slot, i) =>
        slot.kind === 'hidden' ? null : (
          <PlayerHandCard
            key={slot.id}
            slot={slot}
            index={i}
            count={slots.length}
            disabledReason={denialFor(slot)}
            onPlay={() => (slot.kind === 'object' ? onPlayObject(slot.id) : onPlayTerrain(slot.id))}
            onBlocked={onBlocked}
          />
        )
      )}
    </div>
  );
}

function RevealedHandTile({ cardId, kind }: { cardId: string; kind: 'object' | 'terrain' }) {
  const name = kind === 'object' ? objectName(cardId) : terrainName(cardId);
  const inspect = useCardInspect({
    title: name,
    subtitle: 'Révélée dans la main adverse',
    card: { cardId, kind, name },
    body: kind === 'object' ? objectDetailBody(cardId) : terrainDetailBody(cardId),
  });
  return <CardFrame cardId={cardId} kind={kind} name={name} size="small" {...inspect} />;
}

function HiddenHandTile() {
  const inspect = useCardInspect({ title: 'Carte cachée', body: hiddenCardDetailBody() });
  return (
    <div className="hand-strip-hidden" onClick={inspect.onClick} {...inspect.hoverProps}>
      <FaceDownCard />
    </div>
  );
}

/**
 * La main adverse, alignée tout en haut. Dos de cartes par défaut ; une carte dont
 * l'instance nous parvient (un passif ou une capacité qui révèle le jeu adverse) est
 * simplement affichée face visible.
 */
export function OpponentHand({ player }: { player: PlayerState }) {
  const slots = handSlots(player);

  return (
    <div className="hand-strip opponent-hand" role="group" aria-label="Main de l'adversaire">
      {slots.length === 0 && <span className="hand-strip-empty">Main vide</span>}
      {slots.map((slot) => (
        <div className="hand-strip-slot" key={slot.id}>
          {slot.kind === 'hidden' ? <HiddenHandTile /> : <RevealedHandTile cardId={slot.cardId} kind={slot.kind} />}
        </div>
      ))}
    </div>
  );
}
