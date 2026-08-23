/** Maps a status id to its on-card visual treatment. Unknown/custom status ids (card-specific
 * counters, locks, etc.) fall back to a neutral generic effect so they still show *something*. */
interface StatusVisual {
  className: string;
  particles?:
    | 'bubbles'
    | 'embers'
    | 'chain'
    | 'arrow-up'
    | 'arrow-down'
    | 'stun-stars'
    | 'ban'
    | 'dash'
    | 'target'
    | 'mute'
    | 'sparkle'
    | 'lock'
    | 'shield'
    | 'drip';
}

const STATUS_VISUALS: Record<string, StatusVisual> = {
  poison: { className: 'fx-poison', particles: 'bubbles' },
  burn: { className: 'fx-burn', particles: 'embers' },
  bleed: { className: 'fx-bleed', particles: 'drip' },
  chained: { className: 'fx-chained', particles: 'chain' },
  'atk-boost': { className: 'fx-atk-boost', particles: 'arrow-up' },
  'atk-reduction': { className: 'fx-atk-reduction', particles: 'arrow-down' },
  stun: { className: 'fx-stun', particles: 'stun-stars' },
  disarmed: { className: 'fx-disarmed', particles: 'ban' },
  evasive: { className: 'fx-evasive', particles: 'dash' },
  critical: { className: 'fx-critical', particles: 'target' },
  'silence-active': { className: 'fx-silence', particles: 'mute' },
  'silence-passive': { className: 'fx-silence', particles: 'mute' },
  'silence-ultimate': { className: 'fx-silence', particles: 'mute' },
  // Other engine-recognized statuses (see BuiltinStatusId in engine/src/types.ts).
  'death-ward': { className: 'fx-shield', particles: 'shield' },
  'atk-multiplier': { className: 'fx-atk-boost', particles: 'arrow-up' },
  concentration: { className: 'fx-critical', particles: 'target' },
  'damage-reflect': { className: 'fx-shield', particles: 'shield' },
  'bench-damage-bonus': { className: 'fx-atk-boost', particles: 'arrow-up' },
  'hit-bounty': { className: 'fx-critical', particles: 'target' },
  // Card-specific statuses whose semantics (shield / ability lock) match an existing
  // built-in visual closely enough to reuse it, rather than falling back to the generic one.
  'blitzcrank-mana-barrier-shield': { className: 'fx-shield', particles: 'shield' },
  'blitzcrank-hook-locked': { className: 'fx-locked', particles: 'lock' },
};

const DEFAULT_VISUAL: StatusVisual = { className: 'fx-generic', particles: 'sparkle' };

export function visualForStatus(statusId: string): StatusVisual {
  return STATUS_VISUALS[statusId] ?? DEFAULT_VISUAL;
}

function Particles({ kind }: { kind: StatusVisual['particles'] }) {
  switch (kind) {
    case 'bubbles':
      return (
        <>
          <span className="fx-bubble" style={{ left: '20%', animationDelay: '0s' }} />
          <span className="fx-bubble" style={{ left: '50%', animationDelay: '0.5s' }} />
          <span className="fx-bubble" style={{ left: '75%', animationDelay: '1s' }} />
        </>
      );
    case 'embers':
      return (
        <>
          <span className="fx-ember" style={{ left: '25%', animationDelay: '0s' }} />
          <span className="fx-ember" style={{ left: '55%', animationDelay: '0.3s' }} />
          <span className="fx-ember" style={{ left: '78%', animationDelay: '0.6s' }} />
        </>
      );
    case 'drip':
      return (
        <>
          <span className="fx-drip" style={{ left: '30%', animationDelay: '0s' }} />
          <span className="fx-drip" style={{ left: '55%', animationDelay: '0.4s' }} />
          <span className="fx-drip" style={{ left: '72%', animationDelay: '0.8s' }} />
        </>
      );
    case 'chain':
      return <span className="fx-icon fx-chain-icon">⛓</span>;
    case 'arrow-up':
      return <span className="fx-icon fx-arrow-up-icon">▲</span>;
    case 'arrow-down':
      return <span className="fx-icon fx-arrow-down-icon">▼</span>;
    case 'stun-stars':
      return <span className="fx-icon fx-stun-icon">✦</span>;
    case 'ban':
      return <span className="fx-icon fx-ban-icon">⊘</span>;
    case 'dash':
      return <span className="fx-icon fx-dash-icon">»</span>;
    case 'target':
      return <span className="fx-icon fx-target-icon">◎</span>;
    case 'mute':
      return <span className="fx-icon fx-mute-icon">✕</span>;
    case 'sparkle':
      return <span className="fx-icon fx-sparkle-icon">✨</span>;
    case 'lock':
      return <span className="fx-icon fx-lock-icon">🔒</span>;
    case 'shield':
      return <span className="fx-icon fx-shield-icon">🛡</span>;
    default:
      return null;
  }
}

/** Renders one full-card overlay per distinct status effect currently on the character. */
export function StatusEffectLayers({ statusIds }: { statusIds: string[] }) {
  const seen = new Set<string>();
  const visuals: StatusVisual[] = [];
  for (const id of statusIds) {
    const v = visualForStatus(id);
    if (!seen.has(v.className)) {
      seen.add(v.className);
      visuals.push(v);
    }
  }
  if (visuals.length === 0) return null;
  return (
    <>
      {visuals.map((v) => (
        <div key={v.className} className={`fx-layer ${v.className}`}>
          <Particles kind={v.particles} />
        </div>
      ))}
    </>
  );
}
