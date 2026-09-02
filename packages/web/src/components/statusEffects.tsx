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
  // Générique et actuellement sans carte qui le pose (l'ancien "Coeur acier" terrain a été
  // remplacé par l'objet ci-dessous), mais toujours reconnu par le moteur (effect-context.ts).
  'hit-bounty': { className: 'fx-bounty', particles: 'bounty', tone: 'debuff' },
  // « Coeur acier » (objet à lier) : les prochaines attaques du porteur lui rapportent du
  // HP max -- même symbole que atk-boost/extra-attack, c'est un bonus qui monte en jauge.
  'attack-charges': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  vulnerable: { className: 'fx-vulnerable', particles: 'target', tone: 'debuff' },
  // « Jacob et Essau » : deux destins attachés l'un à l'autre. Le visuel de la chaîne
  // (comme `chained`) est le seul du jeu qui dise « attaché », mais en teinte neutre :
  // le lien donne autant qu'il coûte, ce n'est ni un bonus ni un malus.
  linked: { className: 'fx-chained', particles: 'chain', tone: 'neutral' },
  // « Attaque cloné » : une frappe de plus ce tour-ci. Un bonus offensif, donc le visuel
  // de l'ATK en hausse -- sa contrepartie (le silence) arrive plus tard, avec son propre badge.
  'extra-attack': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // « Livre de Chrollo » : une attaque prêtée par une autre carte. Neutre : elle donne
  // autant qu'elle enlève, puisqu'elle ferme toutes les attaques propres du porteur.
  'borrowed-attack': { className: 'fx-mark', particles: 'mark', tone: 'neutral' },
  // « Crit + » : compteur de critiques réussis vers un taux garanti -- même symbole que
  // `critical`/`concentration`, la mécanique qu'il finit par déclencher.
  'crit-streak': { className: 'fx-critical', particles: 'target', tone: 'buff' },
  // Card-specific statuses whose semantics (shield / ability lock) match an existing
  // built-in visual closely enough to reuse it, rather than falling back to the generic one.
  'blitzcrank-mana-barrier-shield': { className: 'fx-shield', particles: 'shield', tone: 'buff' },
  'blitzcrank-hook-locked': { className: 'fx-locked', particles: 'lock', tone: 'debuff' },
  // « Ronces grimpantes » : l'emprise qui monte de 10 % par tour passé au poste actif.
  // Même visuel que `vulnerable`, dont c'est exactement la mécanique.
  'ronces-grimpantes-emprise': { className: 'fx-vulnerable', particles: 'target', tone: 'debuff' },
  // « Manipulation » de Makima : le porteur est visé pour frapper son propre camp.
  'forced-attack': { className: 'fx-vulnerable', particles: 'target', tone: 'debuff' },
  // « Sacrifice » de Makima : une compétence fermée, comme un silence -- mais ciblée.
  'makima-sceau': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  // « Serment de Vengeance » / « Écriture du Nom » de Light Yagami : les marques "Nom"
  // avant la crise cardiaque. Le symbole de la marque, celui qui dit « repéré » sans
  // annoncer de dégâts immédiats.
  'light-yagami-marque-nom': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Mise à mort » de Yumeko : un pari remporté, des dégâts en réserve pour son attaque.
  'yumeko-pari-gagne': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // « Double Face » de Chrollo : la carte est fermée -- ni capacité, ni attaque, ni retour
  // au poste actif. Le visuel du silence, la mécanique dont elle se rapproche le plus.
  'chrollo-scellement': { className: 'fx-silence', particles: 'mute', tone: 'debuff' },
  // Le pendant porté par Chrollo : un livre ouvert lui coûte 25 % de ses PV par tour.
  'chrollo-livre-ouvert': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Vision du Futur » d'Aki : des dégâts en réserve pour sa prochaine attaque.
  'aki-vision-bonus': { className: 'fx-atk-boost', particles: 'arrow-up', tone: 'buff' },
  // « Marque » de Mahito : plus jamais soignable. Même symbole que les autres marques
  // (coeur-acier-mark, light-yagami-marque-nom) -- « repéré », mais permanent, pas armé.
  unhealable: { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // Posé par le moteur après une esquive réussie : le même symbole « interdit » que
  // disarmed, puisque c'est la même idée -- une action momentanément fermée.
  'evasion-locked': { className: 'fx-disarmed', particles: 'ban', tone: 'debuff' },
  // « Absorption Vitale » : le compte à rebours avant sacrifice + résurrection d'un autre
  // personnage. Même symbole que les autres marques d'échéance (coeur-acier-mark,
  // light-yagami-marque-nom) -- « condamné », pas encore résolu.
  'sacrifice-revive': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Tours compté » : le compte à rebours avant la récompense (ou la mort). Même symbole
  // que les autres marques d'échéance -- « en sursis », pas encore résolu.
  'survival-vow': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Chasseur de prime » : contrat en cours, pas encore rempli -- même famille que les
  // autres vœux/marques d'échéance, mais en `buff` : c'est une promesse de bonus, pas
  // un malus (contrairement à sacrifice-revive/survival-vow, qui coûtent quelque chose).
  'bounty-vow': { className: 'fx-mark', particles: 'mark', tone: 'buff' },
  // « Berserk » : vœu en attente, pas encore rempli -- même famille que les autres marques
  // d'échéance.
  'berserk-vow': { className: 'fx-mark', particles: 'mark', tone: 'debuff' },
  // « Buveur de Sang » : récompense permanente de Berserk. Le visuel du saignement (goutte
  // de sang) colle au thème, mais en teinte `buff` -- c'est un bonus pour son porteur, pas
  // un malus comme le statut `bleed` dont il reprend l'animation.
  'buveur-de-sang': { className: 'fx-bleed', particles: 'drip', tone: 'buff' },
};

const DEFAULT_VISUAL: StatusVisual = { className: 'fx-generic', particles: 'sparkle', tone: 'neutral' };

export function visualForStatus(statusId: string): StatusVisual {
  return STATUS_VISUALS[statusId] ?? DEFAULT_VISUAL;
}

/** Teinte du badge d'un statut. Un statut inventé par une carte reste neutre. */
export function toneForStatus(statusId: string): StatusTone {
  return visualForStatus(statusId).tone;
}

/** Nombre de gouttes de sang qui coulent, borné pour rester lisible à 10 stacks. */
const MAX_BLEED_DROPS = 7;

function Particles({ kind, bleedStacks }: { kind: StatusVisual['particles']; bleedStacks: number }) {
  switch (kind) {
    case 'bubbles':
      return (
        <>
          {/* Brume toxique : une nappe qui pulse, plus les bulles qui la traversent. */}
          <span className="fx-poison-mist" />
          <span className="fx-bubble" style={{ left: '18%', animationDelay: '0s' }} />
          <span className="fx-bubble" style={{ left: '38%', animationDelay: '0.4s' }} />
          <span className="fx-bubble" style={{ left: '58%', animationDelay: '0.8s' }} />
          <span className="fx-bubble" style={{ left: '78%', animationDelay: '1.2s' }} />
        </>
      );
    case 'embers':
      // Braises nettement plus denses qu'avant : la distorsion de chaleur seule (posée sur
      // l'illustration par `statusAmbienceClasses`) se lisait mal sans elles.
      return (
        <>
          {[12, 26, 40, 54, 68, 82].map((left, i) => (
            <span key={left} className="fx-ember" style={{ left: `${left}%`, animationDelay: `${i * 0.18}s` }} />
          ))}
          <span className="fx-burn-flames" />
        </>
      );
    case 'drip': {
      // Une goutte par stack (plafonnée) : le sang qui coule dit la gravité sans qu'on ait
      // à lire le badge. La flaque du bas s'épaissit avec elles.
      const drops = Math.max(1, Math.min(MAX_BLEED_DROPS, bleedStacks));
      return (
        <>
          {Array.from({ length: drops }, (_, i) => (
            <span
              key={i}
              className="fx-drip"
              style={{ left: `${12 + (i * 76) / Math.max(1, drops - 1 || 1)}%`, animationDelay: `${i * 0.26}s` }}
            />
          ))}
          <span className="fx-bleed-pool" style={{ ['--pool' as string]: drops / MAX_BLEED_DROPS }} />
        </>
      );
    }
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

/** Ce dont les calques ont besoin d'un statut : son id, et son `data` pour les stacks. */
export interface StatusLike {
  statusId: string;
  data?: Record<string, unknown>;
}

/**
 * Classes d'ambiance posées sur le CADRE de la carte (et non dans un calque par-dessus) :
 * elles filtrent l'illustration elle-même ou débordent du cadre, ce qu'un calque rogné par
 * l'`overflow: hidden` de la carte ne peut pas faire. Une par famille, jamais deux fois.
 */
export function statusAmbienceClasses(statuses: StatusLike[]): string[] {
  const classes = new Set<string>();
  for (const s of statuses) {
    const { className } = visualForStatus(s.statusId);
    if (className === 'fx-burn') classes.add('amb-burn');
    else if (className === 'fx-poison') classes.add('amb-poison');
    else if (className === 'fx-stun') classes.add('amb-frozen');
  }
  return [...classes];
}

/** Renders one full-card overlay per distinct status effect currently on the character. */
export function StatusEffectLayers({ statuses }: { statuses: StatusLike[] }) {
  const seen = new Set<string>();
  const visuals: StatusVisual[] = [];
  for (const s of statuses) {
    const v = visualForStatus(s.statusId);
    if (!seen.has(v.className)) {
      seen.add(v.className);
      visuals.push(v);
    }
  }
  // Le nombre de gouttes suit les stacks de saignement, seule information que le calque
  // tire du `data` d'un statut.
  const bleedStacks = Number(statuses.find((s) => s.statusId === 'bleed')?.data?.['stacks'] ?? 1);

  if (visuals.length === 0) return null;
  return (
    <>
      {visuals.map((v) => (
        <div key={v.className} className={`fx-layer ${v.className}`}>
          <Particles kind={v.particles} bleedStacks={bleedStacks} />
        </div>
      ))}
    </>
  );
}
