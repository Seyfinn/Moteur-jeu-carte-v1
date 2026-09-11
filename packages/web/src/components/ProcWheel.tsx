import type { CSSProperties } from 'react';
import { PROC_HOLD_MS, PROC_SPIN_MS, type ProcRoll } from './gameEvents';

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

/**
 * Verdict en toutes lettres, par sorte de jet : « RÉUSSITE » sur une esquive ne disait pas
 * à qui la réussite profitait (l'attaquant ? le défenseur ?), là où « ESQUIVÉ » / « TOUCHÉ »
 * se lit sans réfléchir. Même chose pour le critique.
 */
const VERDICT: Record<ProcRoll['kind'], { hit: string; miss: string }> = {
  critical: { hit: 'COUP CRITIQUE', miss: 'PAS DE CRITIQUE' },
  evasion: { hit: 'ESQUIVÉ', miss: 'TOUCHÉ' },
  chance: { hit: 'RÉUSSITE', miss: 'ÉCHEC' },
};

/**
 * Plancher d'affichage de la part gagnante. À 1 %, la part réelle fait 3,6° : un cheveu
 * invisible, et une aiguille qui s'y arrête a l'air de s'être posée dans le vide. Le
 * chiffre exact, lui, est toujours écrit à côté de la roue -- c'est LUI qui fait foi, le
 * cadran n'étant qu'une lecture d'un coup d'oeil.
 */
const MIN_SLICE_PERCENT = 7;
/** Symétrique du plancher : au-delà, c'est la part perdante qui deviendrait invisible. */
const MAX_SLICE_PERCENT = 93;
/** Tours complets avalés avant le freinage. */
const FULL_TURNS = 3;

function sliceDegrees(percent: number): number {
  // Un jet garanti n'a AUCUNE zone perdante à dessiner. Le borner à 93 % comme les autres
  // laissait croire au joueur qu'il aurait pu rater un jet qui ne pouvait pas échouer
  // (Godspeed de Killua monte le critique à 100 %).
  if (percent >= 100) return 360;
  // Un pourcentage n'est pas un angle : 33 % de roue, c'est 118,8°, pas 33°.
  return Math.max(MIN_SLICE_PERCENT, Math.min(MAX_SLICE_PERCENT, percent)) * 3.6;
}

function ProcWheelItem({ proc }: { proc: ProcRoll }) {
  const slice = sliceDegrees(proc.percent);
  // L'aiguille tombe au milieu de la part concernée par le résultat réel.
  const stop = proc.hit ? slice / 2 : slice + (360 - slice) / 2;
  const label = proc.label ?? LABEL[proc.kind];
  const odds = proc.percent > 0 ? `${proc.percent} %` : null;
  const verdict = proc.hit ? VERDICT[proc.kind].hit : VERDICT[proc.kind].miss;
  // Sans illustration, le moyeu porte l'initiale du personnage plutôt qu'un disque vide :
  // on sait encore de qui il s'agit d'un coup d'oeil.
  const initial = proc.characterName?.trim().charAt(0).toUpperCase() ?? '';

  // Les deux durées viennent du moteur d'événements et redescendent au CSS en variables :
  // c'est ce qui garantit que la roue ne disparaît jamais en pleine rotation, quel que soit
  // le réglage. La feuille de style ne connaît plus une seule durée de jet en dur.
  const style = {
    '--proc-spin': `${PROC_SPIN_MS}ms`,
    '--proc-hold': `${PROC_HOLD_MS}ms`,
    '--slice': `${slice.toFixed(1)}deg`,
    '--spin': `${FULL_TURNS * 360 + stop}deg`,
  } as CSSProperties;

  return (
    <div className={`proc-wheel${proc.hit ? ' hit' : ' miss'}`} style={style}>
      <div className="proc-wheel-dial" aria-hidden="true">
        {/* Graduations du pourtour : elles donnent une échelle à la part colorée, sans quoi
            le cadran se lit comme un camembert décoratif plutôt que comme une probabilité. */}
        <span className="proc-wheel-ticks" />
        <span className="proc-wheel-needle" />
        {/* Le moyeu porte l'illustration du personnage concerné, et il est posé APRÈS
            l'aiguille pour lui couvrir le pied : ce qui tourne autour du portrait se lit
            comme une aiguille de cadran, là où un trait partant du centre se lisait comme
            une part de plus. Un id de carte sans illustration laisse simplement un disque
            sombre -- aucun état d'erreur à gérer, le fond ne se peint pas. */}
        <span
          className={`proc-wheel-hub${proc.cardId ? '' : ' proc-wheel-hub-empty'}`}
          style={proc.cardId ? ({ backgroundImage: `url(/cards/${proc.cardId}.png)` } as CSSProperties) : undefined}
        >
          {!proc.cardId && initial}
        </span>
      </div>
      <div className="proc-wheel-text" aria-hidden="true">
        <span className="proc-wheel-verdict">{proc.hit ? '✓' : '✗'}</span>
        <span className="proc-wheel-label">
          {label}
          {/* Le pourcentage vaut 0 quand le moteur n'a pas annoncé de taux : mieux vaut ne
              rien afficher qu'un « 0 % » qui ferait mentir la roue. */}
          {odds && <span className="proc-wheel-percent">{odds}</span>}
        </span>
        {proc.characterName && <span className="proc-wheel-who">{proc.characterName}</span>}
        <span className="proc-wheel-badge">{verdict}</span>
      </div>
      {/* Toute la roue était `aria-hidden` : un joueur au lecteur d'écran ne savait tout
          simplement pas qu'un jet avait eu lieu, alors que c'est lui qui décide du coup. Le
          cadran reste masqué (il n'a rien à dire de plus que le texte), et cette ligne
          annonce le jet en une phrase. Rien n'est divulgué en avance : elle arrive avec la
          roue, et l'ordre de lecture est déjà celui du verdict. */}
      <span className="proc-wheel-a11y" role="status">
        {[proc.characterName, label, odds, verdict.toLowerCase()].filter(Boolean).join(' — ')}
      </span>
    </div>
  );
}

/**
 * La file des jets en cours. UNE SEULE roue à l'écran à la fois : deux jets dans le même lot
 * (Escanor en lance deux) donnaient deux roues qui tournaient côte à côte au centre de
 * l'écran, sans qu'on puisse dire laquelle allait avec quoi. Elles se suivent désormais,
 * `useGameEvents` échelonnant leurs retraits -- même solution que pour les cartes mises en
 * avant, qui avaient exactement le même problème.
 *
 * `pointer-events: none` sur toute la pile : le plateau n'est ni décalé ni rendu inerte
 * pendant que la roue tourne.
 */
export function ProcWheels({ rolls }: { rolls: ProcRoll[] }) {
  const current = rolls[0];
  if (!current) return null;
  return (
    <div className="proc-wheel-stack">
      {/* La clé porte l'id : deux jets qui se suivent rejouent bien toute la mise en scène
          au lieu de se remplacer en silence dans le même noeud. */}
      <ProcWheelItem key={current.id} proc={current} />
    </div>
  );
}
