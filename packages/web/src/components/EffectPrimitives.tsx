import type { CSSProperties, ReactNode } from 'react';

/** Small, deterministic particle fields: no canvas loop or random values during render. */
export function EffectParticles({ count = 8, className = '' }: { count?: number; className?: string }) {
  return (
    <span className={`effect-particles ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{
          '--particle-angle': `${i * 360 / count + 12}deg`,
          '--particle-delay': `${(i % 4) * 35}ms`,
          '--particle-distance': `${48 + (i % 3) * 22}px`,
          '--particle-size': `${2 + i % 3}px`,
        } as CSSProperties} />
      ))}
    </span>
  );
}

export type EffectGlyphKind = 'chain' | 'arrow-up' | 'arrow-down' | 'stun-stars' | 'ban' | 'dash'
  | 'target' | 'mute' | 'sparkle' | 'lock' | 'shield' | 'mark' | 'bounty';

const GLYPHS: Record<EffectGlyphKind, ReactNode> = {
  chain: <><rect x="4" y="9" width="14" height="8" rx="4" transform="rotate(-40 11 13)" /><rect x="14" y="15" width="14" height="8" rx="4" transform="rotate(-40 21 19)" /><path d="m12 20 8-8" /></>,
  'arrow-up': <><path d="m7 17 9-10 9 10M10 24l6-7 6 7M16 7v15" /></>,
  'arrow-down': <><path d="m7 15 9 10 9-10M10 8l6 7 6-7M16 25V10" /></>,
  'stun-stars': <><path d="m16 3 3 9 9 4-9 3-3 10-3-10-9-3 9-4Z" /><path d="m26 3 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" /></>,
  ban: <><circle cx="16" cy="16" r="11" /><path d="m8 8 16 16" /></>,
  dash: <><path d="m11 7 9 9-9 9M20 7l9 9-9 9M2 12h7M1 20h8" /></>,
  target: <><circle cx="16" cy="16" r="9" /><circle cx="16" cy="16" r="3" /><path d="M16 2v7m0 14v7M2 16h7m14 0h7" /></>,
  mute: <><path d="M4 13h5l7-6v18l-7-6H4ZM22 11l7 10m0-10-7 10" /></>,
  sparkle: <><path d="m16 3 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z" /></>,
  lock: <><rect x="7" y="14" width="18" height="14" rx="3" /><path d="M11 14V9a5 5 0 0 1 10 0v5M16 19v4" /></>,
  shield: <><path d="m16 3 11 5v8c0 6-7 11-11 13C12 27 5 22 5 16V8Z" /><path d="m10 16 4 4 8-9" /></>,
  mark: <><path d="m16 3 12 13-12 13L4 16Z" /><circle cx="16" cy="16" r="4" /><path d="M16 3v5m0 16v5" /></>,
  bounty: <><path d="m16 3 12 13-12 13L4 16Z" /><path d="m12 19 4-8 4 8M13 17h6" /></>,
};

export function EffectGlyph({ kind, className = '' }: { kind: EffectGlyphKind; className?: string }) {
  return <svg className={`effect-glyph ${className}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPHS[kind]}</svg>;
}

/** Concentric engraved circles, also used behind card reveals. */
export function EffectSigil({ className = '' }: { className?: string }) {
  return (
    <svg className={`effect-sigil ${className}`} viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="100" cy="100" r="94" strokeWidth=".7" />
      <circle cx="100" cy="100" r="86" strokeWidth="3" strokeDasharray="1 13" />
      <circle cx="100" cy="100" r="76" strokeWidth="1" strokeDasharray="70 12 8 12" />
      <path d="m100 23 67 116H33Zm0 154L33 61h134Z" strokeWidth=".65" />
      <circle cx="100" cy="100" r="43" strokeWidth=".6" />
    </svg>
  );
}
