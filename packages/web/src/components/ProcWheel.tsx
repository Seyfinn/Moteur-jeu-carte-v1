import type { CSSProperties } from 'react';
import type { ProcRoll } from './gameEvents';

/**
 * Mini-roue de chance : elle sort pour tout jet à pourcentage porté par une carte --
 * critique et esquive au taux d'une carte (le taux de base d'un personnage ne la déclenche
 * jamais, c'est le moteur qui fait le tri), et n'importe quel jet nommé par la carte
 * elle-même via `ctx.rollChance` (désarmement, stun, silence, poison, redirection...).
 *
 * Deux parts : la part gagnante occupe le pourcentage annoncé, le reste est perdant.
 * L'aiguille s'arrête donc dans une zone qui correspond visuellement à la vraie chance.
 */
const LABEL: Record<ProcRoll['kind'], string> = {
  critical: 'Critique',
  evasion: 'Esquive',
  chance: 'Effet', // remplacé par le libellé que la carte a donné au jet
};

function ProcWheelItem({ proc }: { proc: ProcRoll }) {
  // La part gagnante est bornée : à 2 % elle serait invisible, à 100 % il n'y aurait plus
  // de roue du tout. On garde une part lisible sans mentir sur l'issue, qui est déjà jouée.
  const slicePercent = Math.max(8, Math.min(92, proc.percent || 50));
  // Un pourcentage n'est pas un angle : 33 % de roue, c'est 118,8°, pas 33°.
  const slice = slicePercent * 3.6;
  // L'aiguille tombe au milieu de la part concernée par le résultat réel.
  const stop = proc.hit ? slice / 2 : slice + (360 - slice) / 2;
  const spin = 3 * 360 + stop;

  return (
    <div className={`proc-wheel${proc.hit ? ' hit' : ' miss'}`}>
      <div
        className="proc-wheel-dial"
        style={{ '--slice': `${slice.toFixed(1)}deg`, '--spin': `${spin}deg` } as CSSProperties}
      >
        <span className="proc-wheel-needle" aria-hidden="true" />
      </div>
      <div className="proc-wheel-text">
        <span className="proc-wheel-verdict">{proc.hit ? '✓' : '✗'}</span>
        <span className="proc-wheel-label">
          {proc.label ?? LABEL[proc.kind]}
          {proc.percent > 0 && <span className="proc-wheel-percent"> {proc.percent}%</span>}
        </span>
        {proc.characterName && <span className="proc-wheel-who">{proc.characterName}</span>}
        <span className="proc-wheel-badge">{proc.hit ? 'RÉUSSITE' : 'ÉCHEC'}</span>
      </div>
    </div>
  );
}

/** Pile des mini-roues en cours, posée au-dessus du plateau. */
export function ProcWheels({ rolls }: { rolls: ProcRoll[] }) {
  if (rolls.length === 0) return null;
  return (
    <div className="proc-wheel-stack" aria-hidden="true">
      {rolls.map((roll) => (
        <ProcWheelItem key={roll.id} proc={roll} />
      ))}
    </div>
  );
}
