import type { LogEntry } from 'engine';

export function EventLog({ log }: { log: LogEntry[] }) {
  const recent = log.slice(-40).reverse();
  return (
    <div className="event-log">
      <h3>Journal</h3>
      <ul>
        {recent.map((entry) => (
          <li key={entry.id}>
            <span className="log-turn">T{entry.turnNumber}</span> {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
