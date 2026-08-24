import { useEffect, useRef, useState } from 'react';
import type { LogEntry, PlayerId } from 'engine';

/** Small icon per engine log `data.kind`, so the journal can be skimmed at a glance. */
const KIND_ICON: Record<string, string> = {
  attack: '⚔️',
  'use-ability': '✨',
  'play-object': '🎒',
  'play-terrain': '🗺️',
  pass: '⏭️',
  damage: '💥',
  'status-tick': '☠️',
  heal: '💚',
  shield: '🛡️',
  'shield-absorb': '🛡️',
  'valeur-lock': '🔻',
  'max-hp': '🔺',
  ko: '💀',
  revive: '⭐',
  switch: '🔁',
  status: '🔮',
  critical: '🎯',
  evasion: '💨',
  redirect: '↪️',
  'coin-flip': '🪙',
  initiative: '🪙',
  'destroy-object': '💣',
  'terrain-removed': '🍂',
  'terrain-duration': '⏳',
  'gain-object': '🃏',
  'concentration-missed': '😖',
  'trigger-depth': '⚠️',
  error: '⚠️',
  info: 'ℹ️',
};

const MAX_ENTRIES = 60;

function kindOf(entry: LogEntry): string | undefined {
  const kind = entry.data?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

export function EventLog({ log, you }: { log: LogEntry[]; you?: PlayerId }) {
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const recent = log.slice(-MAX_ENTRIES).reverse();

  // Newest first, so "scrolled to the top" is the live view. A burst of entries
  // resolved while the player was reading older ones shouldn't strand them mid-list.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [log.length]);

  return (
    <div className={`event-log${collapsed ? ' collapsed' : ''}`}>
      <button className="event-log-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span className={collapsed ? 'event-log-chevron collapsed' : 'event-log-chevron'}>▾</span>
        <h3>Journal</h3>
      </button>
      {!collapsed && (
        <ul ref={listRef}>
          {recent.length === 0 && <li className="log-empty">Rien ne s'est encore passé.</li>}
          {recent.map((entry) => {
            const kind = kindOf(entry);
            const mine = you !== undefined && entry.playerId === you;
            return (
              <li key={entry.id} className={`log-entry${kind ? ` log-kind-${kind}` : ''}${mine ? ' log-mine' : ''}`}>
                <span className="log-turn">T{entry.turnNumber}</span>
                <span className="log-icon">{(kind && KIND_ICON[kind]) ?? '·'}</span>
                <span className="log-message">{entry.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
