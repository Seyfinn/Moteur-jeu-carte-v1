/**
 * Famille de couleur d'un statut. C'est le code couleur que le joueur apprend une fois
 * pour toutes : violet = poison, orange = brûlure, rouge = saignement, cyan = entravé
 * (stun / chaînes), vert = bonus, rouge sombre = malus. Il sert au badge posé sur la
 * carte ET au glossaire en partie, pour que le même effet ait la même teinte partout.
 */
export type StatusTone = 'poison' | 'burn' | 'bleed' | 'freeze' | 'buff' | 'debuff' | 'neutral';

export const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  poison: '#b07ede',
  burn: '#ff8a3d',
  bleed: '#e05555',
  freeze: '#5fd0f0',
  buff: '#4fd39a',
  debuff: '#ff6b6b',
  neutral: '#f0b7d0',
};

/** Maps a status id to its on-card visual treatment. Unknown/custom status ids (card-specific
 * counters, locks, etc.) fall back to a neutral generic effect so they still show *something*. */
interface StatusVisual {
  className: string;
  tone: StatusTone;
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
    | 'drip'
    | 'mark'
    | 'bounty';
}

const STATUS_VISUALS: Record<string, StatusVisual> = {
  poison: { className: 'fx-poison', particles: 'bubbles', tone: 'poison' },
  burn: { className: 'fx-burn', particles: 'embers', tone: 'burn' },
  bleed: { className: 'fx-bleed', particles: 'drip', tone: 'bleed' },
  chained: { className: 'fx-chained', particles: 'chain', tone: 'freeze' },
  'atk-boost': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  'atk-reduction': { className: 'fx-atk-reduction', particles: 'arrow-down', tone: 'debuff' },
  stun: { className: 'fx-stun', particles: 'stun-stars', tone: 'freeze' },
  disarmed: { className: 'fx-disarmed', particles: 'ban', tone: 'debuff' },
  evasive: { className: 'fx-evasive', particles: 'dash', tone: 'buff' },
  critical: { className: 'fx-critical', particles: 'target', tone: 'buff' },
  'silence-active': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  'silence-passive': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  'silence-ultimate': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  // Other engine-recognized statuses (see BuiltinStatusId in engine/src/types.ts).
  'death-ward': { className: 'fx-shield', particles: 'shield', tone: 'buff' },
  'atk-multiplier': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  concentration: { className: 'fx-critical', particles: 'target', tone: 'buff' },
  'damage-reflect': { className: 'fx-shield', particles: 'shield', tone: 'buff' },
  'bench-damage-bonus': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // Marque posée sur le porteur au bénéfice de celui qui le frappe : un malus, pas un bonus.
  // Visuel dédié (et non celui du critique) : c'est la version *armée* de `coeur-acier-mark`,
  // même symbole, en or et en mouvement -- le porteur doit voir que la prime est prête.
  'hit-bounty': { className: 'fx-bounty', particles: 'bounty', tone: 'debuff' },
  vulnerable: { className: 'fx-vulnerable', particles: 'target', tone: 'debuff' },
  // « Jacob et Essau » : deux destins attachés l'un à l'autre. Le visuel de la chaîne
  // (comme `chained`) est le seul du jeu qui dise « attaché », mais en teinte neutre :
  // le lien donne autant qu'il coûte, ce n'est ni un bonus ni un malus.
  linked: { className: 'fx-chained', particles: 'chain', tone: 'neutral' },
  // « Attaque cloné » : une frappe de plus ce tour-ci. Un bonus offensif, donc le visuel
  // de l'ATK en hausse -- sa contrepartie (le silence) arrive plus tard, avec son propre badge.
  'extra-attack': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // « Crit + » : compteur de critiques réussis vers un taux garanti -- même symbole que
  // `critical`/`concentration`, la mécanique qu'il finit par déclencher.
  'crit-streak': { className: 'fx-critical', particles: 'target', tone: 'buff' },
  // Card-specific statuses whose semantics (shield / ability lock) match an existing
  // built-in visual closely enough to reuse it, rather than falling back to the generic one.
  'blitzcrank-mana-barrier-shield': { className: 'fx-shield', particles: 'shield', tone: 'buff' },
  // Marque de Coeur Acier, avant qu'elle ne se charge : même symbole que `hit-bounty`
  // ci-dessus, en bleu acier et immobile -- « repérée, mais pas encore dangereuse ».
  'coeur-acier-mark': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  'blitzcrank-hook-locked': { className: 'fx-locked', particles: 'lock', tone: 'debuff' },
  // « Manipulation » de Makima : le porteur est visé pour frapper son propre camp.
  'forced-attack': { className: 'fx-vulnerable', particles: 'target', tone: 'debuff' },
  // « Sacrifice » de Makima : une compétence fermée, comme un silence -- mais ciblée.
  'makima-sceau': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  // « Sermet de Vengeance » de Light Yagami : le compte à rebours avant la crise cardiaque.
  // Le symbole de la marque, celui qui dit « repéré » sans annoncer de dégâts immédiats.
  'light-yagami-crise': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Manipulation » de Light Yagami : un switch fermé à clé, pas une chaîne (les switchs
  // forcés passent toujours) -- d'où le cadenas plutôt que le visuel de `chained`.
  'light-yagami-emprise': { className: 'fx-locked', particles: 'lock', tone: 'debuff' },
  // « Mise à mort » de Yumeko : un pari remporté, des dégâts en réserve pour son attaque.
  'yumeko-pari-gagne': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // « Double Face » de Chrollo : la carte est fermée -- ni capacité, ni attaque, ni retour
  // au poste actif. Le visuel du silence, la mécanique dont elle se rapproche le plus.
  'chrollo-scellement': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  // Le pendant porté par Chrollo : un livre ouvert lui coûte 25 % de ses PV par tour.
  'chrollo-livre-ouvert': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Vision du Futur » d'Aki : des dégâts en réserve pour sa prochaine attaque.
  'aki-vision-bonus': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
};

const DEFAULT_VISUAL: StatusVisual = { className: 'fx-generic', particles: 'sparkle', tone: 'neutral' };

export function visualForStatus(statusId: string): StatusVisual {
  return STATUS_VISUALS[statusId] ?? DEFAULT_VISUAL;
}

/** Teinte du badge d'un statut. Un statut inventé par une carte reste neutre. */
export function toneForStatus(statusId: string): StatusTone {
  return visualForStatus(statusId).tone;
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
    case 'mark':
      return <span className="fx-icon fx-mark-icon">❖</span>;
    case 'bounty':
      return <span className="fx-icon fx-bounty-icon">❖</span>;
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
