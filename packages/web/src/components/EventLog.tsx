import { useEffect, useRef, useState } from 'react';
import type { LogEntry, PlayerId } from 'engine';

/** Small icon per engine log `data.kind`, so the journal can be skimmed at a glance. */
const KIND_ICON: Record<string, string> = {
  attack: '⚔️',
  'use-ability': '✨',
  'play-object': '🎒',
  'play-terrain': '🗺️',
  pass: '⏭️',
  forfeit: '🏳️',
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
  recycle: '♻️',
  'concentration-missed': '😖',
  'chance-roll': '🎲',
  'proc-miss': '🎲',
  blocked: '⛓️',
  'trigger-depth': '⚠️',
  error: '⚠️',
  info: 'ℹ️',
};

const MAX_ENTRIES = 60;

function kindOf(entry: LogEntry): string | undefined {
  const kind = entry.data?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

/**
 * Journal de combat : une pastille ronde en bas à gauche, qui ouvre au clic un tiroir
 * coulissant depuis le bord gauche de l'écran. Il démarre réduit -- ouvert d'emblée, il
 * couvrait une bonne part du plateau dès la première seconde, et l'immense majorité des
 * tours se lit très bien sans lui.
 *
 * Le tiroir reste monté même fermé : c'est ce qui lui permet de coulisser (une simple
 * translation) au lieu d'apparaître d'un coup, et la liste garde sa position de défilement
 * d'une ouverture à l'autre.
 */
export function EventLog({ log, you }: { log: LogEntry[]; you?: PlayerId }) {
  const [open, setOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(log.length);
  const listRef = useRef<HTMLUListElement>(null);

  const recent = log.slice(-MAX_ENTRIES).reverse();
  const unread = Math.max(0, log.length - seenCount);

  // Newest first, so "scrolled to the top" is the live view. A burst of entries
  // resolved while the player was reading older ones shouldn't strand them mid-list.
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: 0 });
  }, [log.length, open]);

  // Le compteur de non-lus ne court que pendant que le tiroir est fermé.
  useEffect(() => {
    if (open) setSeenCount(log.length);
  }, [open, log.length]);

  // Échap referme le tiroir : il recouvre le bord gauche du plateau, on doit pouvoir le
  // renvoyer sans viser la croix.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          className="event-log-pill"
          onClick={() => setOpen(true)}
          title="Ouvrir le journal de combat"
          aria-label="Ouvrir le journal de combat"
        >
          📜
          {unread > 0 && <span className="event-log-unread">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
      <aside className={`event-log-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <header className="event-log-head">
          <span className="event-log-grip" aria-hidden="true">
            📜
          </span>
          <h3>Journal</h3>
          <button
            className="event-log-close"
            onClick={() => setOpen(false)}
            title="Fermer le journal"
            aria-label="Fermer le journal"
          >
            ×
          </button>
        </header>
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
      </aside>
    </>
  );
}
