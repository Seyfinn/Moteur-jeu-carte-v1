import type { PlayerId } from 'engine';
import type { CharacterBadge, TableEvent } from './gameEvents';

const CHARACTER_BADGE_LABEL: Record<CharacterBadge['kind'], string> = {
  attack: '⚔️',
  ability: '✨',
  critical: '🎯',
  evasion: '💨',
  ko: '💀',
};

function characterBadgeText(badge: CharacterBadge): string {
  switch (badge.kind) {
    case 'attack':
    case 'ability':
    case 'ko':
      return badge.label;
    case 'critical':
      return `CRIT ${badge.percent}%`;
    case 'evasion':
      return `ESQ. ${badge.percent}%`;
  }
}

/** Rendered inside a CharacterCard's `effects` overlay slot. */
export function CharacterActionBadges({ badges }: { badges: CharacterBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="fx-action-badges">
      {badges.map((b) => (
        <span key={b.id} className={`fx-action-badge fx-action-badge-${b.kind}`}>
          {CHARACTER_BADGE_LABEL[b.kind]} {characterBadgeText(b)}
        </span>
      ))}
    </div>
  );
}

function tableEventContent(e: TableEvent): { icon: string; text: string } {
  switch (e.kind) {
    case 'turn-transition':
      return { icon: '🔁', text: `Tour ${e.turnNumber} -- ${e.startingName}` };
    case 'coin-flip':
      return { icon: '🪙', text: e.label };
  }
}

/** Fixed banner stack overlaid on the board for table-level events (turn changes, coin flips).
 * Character-level events (attack/ability/crit/evasion) render on their card instead via
 * CharacterActionBadges, and a card being played is projected full-size by CardSpotlights.
 *
 * Une seule exception à la pastille : la main qui NOUS revient. C'est l'information la plus
 * importante de la partie -- elle a droit à une bande qui balaie tout l'écran, là où une
 * pastille de plus dans la pile passait inaperçue au milieu du reste. Le passage de main à
 * l'adversaire, lui, reste une pastille : c'est une information d'attente. */
export function TableEventBanners({ events, you }: { events: TableEvent[]; you: PlayerId }) {
  if (events.length === 0) return null;
  const isMyTurnStart = (e: TableEvent) => e.kind === 'turn-transition' && e.startingPlayerId === you;
  const sweeps = events.filter(isMyTurnStart);
  const pills = events.filter((e) => !isMyTurnStart(e));

  return (
    <>
      {sweeps.map((e) => (
        <div key={e.id} className="turn-sweep" aria-hidden="true">
          <div className="turn-sweep-band">
            <span className="turn-sweep-shine" />
            <strong className="turn-sweep-title">À vous de jouer</strong>
            <span className="turn-sweep-sub">{e.kind === 'turn-transition' ? `Tour ${e.turnNumber}` : ''}</span>
          </div>
        </div>
      ))}
      {pills.length > 0 && (
        <div className="table-event-stack">
          {pills.map((e) => {
            const { icon, text } = tableEventContent(e);
            return (
              <div key={e.id} className={`table-event-banner table-event-${e.kind}`}>
                <span className="table-event-icon">{icon}</span>
                <span>{text}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
