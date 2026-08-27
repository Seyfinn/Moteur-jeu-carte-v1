import { useEffect, useState } from 'react';
import {
  BASE_CRITICAL_CHANCE_PERCENT,
  BASE_CRITICAL_MULTIPLIER,
  BASE_EVASION_CHANCE_PERCENT,
  BLEED_PERCENT_PER_STACK,
  BURN_DAMAGE,
  CRITICAL_STATUS_CHANCE_PERCENT,
  EVASIVE_STATUS_CHANCE_PERCENT,
  EVASION_LOCKOUT_TURNS,
  POISON_FLAT_DAMAGE,
  POISON_PERCENT_OF_MAX_HP,
  VULNERABLE_DAMAGE_BONUS_PERCENT,
} from 'engine';
import { STATUS_TONE_COLOR, type StatusTone } from './statusEffects';

/**
 * Règles de jeu consultables en cours de partie. Chaque nombre affiché vient d'une
 * constante du moteur, jamais d'un chiffre recopié à la main : un ajustement
 * d'équilibrage côté moteur se lit ici sans qu'on ait à y repenser.
 *
 * Ce panneau ne décrit QUE les mécaniques génériques que le moteur applique lui-même
 * (cf. `BUILTIN_STATUS_IDS` dans engine/src/statuses.ts). Le texte d'une carte, lui,
 * reste affiché tel quel sur la carte -- ce n'est pas ici qu'on l'explique.
 */
interface GlossaryEntry {
  id: string;
  name: string;
  icon: string;
  /**
   * Famille de couleur, la même que celle du badge posé sur la carte : elle vient de
   * `statusEffects.tsx` et jamais d'une teinte recopiée ici, sinon les deux surfaces
   * finissent par se contredire sur le même effet.
   */
  tone: StatusTone;
  text: string;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

const ENTRIES: GlossaryEntry[] = [
  {
    id: 'poison',
    name: 'Poison',
    icon: '☠',
    tone: 'poison',
    text: `${POISON_FLAT_DAMAGE} HP + ${pct(POISON_PERCENT_OF_MAX_HP)} des HP max par tour.`,
  },
  {
    id: 'burn',
    name: 'Burn (Brûlure)',
    icon: '🔥',
    tone: 'burn',
    text: `${BURN_DAMAGE} HP par tour. Rebrûler une cible déjà en feu additionne les durées.`,
  },
  {
    id: 'bleed',
    name: 'Bleed (Saignement)',
    icon: '🩸',
    tone: 'bleed',
    text:
      `Dégâts par tour selon le nombre de stacks sur les HP max ` +
      `(1 stack = ${pct(BLEED_PERCENT_PER_STACK)}, 2 = ${pct(BLEED_PERCENT_PER_STACK * 2)}, ` +
      `3 = ${pct(BLEED_PERCENT_PER_STACK * 3)}, 4 = ${pct(BLEED_PERCENT_PER_STACK * 4)}, ` +
      `5 = ${pct(BLEED_PERCENT_PER_STACK * 5)}, etc.).`,
  },
  {
    id: 'vulnerable',
    name: 'Vulnérable',
    icon: '🎯',
    tone: 'debuff',
    text: `La cible prend +${VULNERABLE_DAMAGE_BONUS_PERCENT}% de dégâts.`,
  },
  {
    id: 'stun',
    name: 'Stun',
    icon: '✦',
    tone: 'freeze',
    text: "Bloque totalement le personnage (ne peut ni attaquer, ni switcher, ni utiliser d'ability).",
  },
  {
    id: 'disarmed',
    name: 'Désarmé',
    icon: '⊘',
    tone: 'debuff',
    text: "Empêche le personnage d'effectuer une attaque.",
  },
  {
    id: 'silence-active',
    name: 'Silence actif',
    icon: '✕',
    tone: 'debuff',
    text: "Empêche l'utilisation des abilities actives.",
  },
  {
    id: 'silence-passive',
    name: 'Silence passif',
    icon: '✕',
    tone: 'debuff',
    text: 'Empêche le déclenchement des abilities passives.',
  },
  {
    id: 'silence-ultimate',
    name: 'Silence ultime',
    icon: '✕',
    tone: 'debuff',
    text: 'Bloque simultanément les abilities actives et passives.',
  },
  {
    id: 'critical',
    name: 'Critique',
    icon: '◎',
    tone: 'buff',
    text: `${CRITICAL_STATUS_CHANCE_PERCENT}% de chance de proc → fait x${BASE_CRITICAL_MULTIPLIER} de dégâts.`,
  },
  {
    id: 'evasive',
    name: 'Esquive',
    icon: '»',
    tone: 'buff',
    text: `${EVASIVE_STATUS_CHANCE_PERCENT}% de chance d'esquiver, annulant totalement l'attaque ennemi.`,
  },
  {
    id: 'extra-attack',
    name: 'Attaque supplémentaire',
    icon: '⇈',
    tone: 'buff',
    text:
      "Le personnage peut attaquer une fois de plus ce tour au lieu de le terminer. " +
      'La frappe supplémentaire inflige un pourcentage réduit des dégâts.',
  },
  {
    id: 'linked',
    name: 'Lié',
    icon: '⛓',
    tone: 'neutral',
    text:
      "Les deux personnages liés attaquent ensemble, subissent chaque instance de dégâts ensemble, " +
      'et meurent ensemble. Seul celui des deux qui tient le poste actif peut utiliser ses abilities.',
  },
  {
    id: 'borrowed-attack',
    name: 'Attaque empruntée',
    icon: '❖',
    tone: 'neutral',
    text:
      "Le personnage gagne une attaque qui n'est pas sur sa carte. Tant que le prêt tient, " +
      "c'est la seule qu'il puisse porter : ses propres attaques sont fermées.",
  },
  {
    id: 'forced-attack',
    name: 'Manipulé',
    icon: '🎯',
    tone: 'debuff',
    text:
      "Au début de son prochain tour, le personnage retourne son attaque contre un allié désigné " +
      'de son propre banc, puis son tour se termine aussitôt.',
  },
  {
    id: 'unhealable',
    name: 'Marqué (Mahito)',
    icon: '❖',
    tone: 'debuff',
    text: "Plus aucun soin n'a d'effet sur le personnage, définitivement.",
  },
  {
    id: 'evasion-locked',
    name: 'Ne peut plus esquiver',
    icon: '⊘',
    tone: 'debuff',
    text: `Posé automatiquement après une esquive réussie : 0% de chance d'esquiver pendant ${EVASION_LOCKOUT_TURNS} tour(s).`,
  },
];

const BASE_RULES = [
  `Tous les personnages ont de base ${BASE_CRITICAL_CHANCE_PERCENT}% de chance de critique sur toutes leurs attaques et ${BASE_EVASION_CHANCE_PERCENT}% de chance d'esquiver.`,
  'Ne s’applique pas au Burn, au Poison et au Bleed.',
];

function GlossaryPanel({ onClose }: { onClose: () => void }) {
  // Échap ferme le volet : même sortie clavier que les autres panneaux du plateau.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="glossary-backdrop" onClick={onClose} />
      <aside className="glossary-panel" role="dialog" aria-label="Glossaire des effets">
        <header className="glossary-header">
          <h3>Glossaire des effets</h3>
          <button className="hover-card-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="glossary-scroll">
          <ul className="glossary-list">
            {ENTRIES.map((entry) => (
              <li
                key={entry.id}
                className="glossary-entry"
                style={{ ['--glossary-accent' as string]: STATUS_TONE_COLOR[entry.tone] }}
              >
                <span className="glossary-icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <div className="glossary-entry-text">
                  <strong>{entry.name}</strong>
                  <p>{entry.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <section className="glossary-rules">
            <h4>Règles de base</h4>
            {BASE_RULES.map((rule) => (
              <p key={rule}>{rule}</p>
            ))}
          </section>
        </div>
      </aside>
    </>
  );
}

/** Bouton de la barre du haut + le volet qu'il ouvre. */
export function EffectsGlossaryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="board-leave glossary-button"
        onClick={() => setOpen(true)}
        title="Consulter les effets et les règles de base"
      >
        {/* Le libellé disparaît sous 760px : la barre du haut y est déjà pleine, et c'est
            l'indicateur de tour qui doit garder la place. */}
        📖<span className="glossary-button-label"> Effets</span>
      </button>
      {open && <GlossaryPanel onClose={() => setOpen(false)} />}
    </>
  );
}
