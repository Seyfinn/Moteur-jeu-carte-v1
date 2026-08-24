import type { CharacterBadge, TableEvent } from './gameEvents';

const CHARACTER_BADGE_LABEL: Record<CharacterBadge['kind'], string> = {
  attack: '⚔️',
  ability: '✨',
  critical: '🎯',
  evasion: '💨',
  heal: '💚',
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
    case 'heal':
      return `+${badge.amount}`;
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
    case 'object':
      return { icon: '🎒', text: `${e.playerName} joue ${e.label}` };
    case 'terrain':
      return { icon: '🗺️', text: `${e.playerName} pose ${e.label}` };
    case 'coin-flip':
      return { icon: '🪙', text: e.label };
  }
}

/** Fixed banner stack overlaid on the board for table-level events (turn changes, object/terrain
 * plays, coin flips). Character-level events (attack/ability/crit/evasion) render on their card
 * instead via CharacterActionBadges. */
export function TableEventBanners({ events }: { events: TableEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="table-event-stack">
      {events.map((e) => {
        const { icon, text } = tableEventContent(e);
        return (
          <div key={e.id} className={`table-event-banner table-event-${e.kind}`}>
            <span className="table-event-icon">{icon}</span>
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
