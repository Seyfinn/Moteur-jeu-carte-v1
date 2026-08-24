import { useEffect, useState } from 'react';
import {
  BASE_CRITICAL_CHANCE_PERCENT,
  BASE_CRITICAL_MULTIPLIER,
  BASE_EVASION_CHANCE_PERCENT,
  BLEED_PERCENT_PER_STACK,
  BURN_DAMAGE,
  CRITICAL_STATUS_CHANCE_PERCENT,
  EVASIVE_STATUS_CHANCE_PERCENT,
  POISON_FLAT_DAMAGE,
  POISON_PERCENT_OF_MAX_HP,
  VULNERABLE_DAMAGE_BONUS_PERCENT,
} from 'engine';

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
  /** Teinte de l'entrée, alignée sur l'effet visuel de la carte (voir statusEffects.tsx). */
  color: string;
  text: string;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

const ENTRIES: GlossaryEntry[] = [
  {
    id: 'poison',
    name: 'Poison',
    icon: '☠',
    color: '#b07ede',
    text: `${POISON_FLAT_DAMAGE} HP + ${pct(POISON_PERCENT_OF_MAX_HP)} des HP max par tour.`,
  },
  {
    id: 'burn',
    name: 'Burn (Brûlure)',
    icon: '🔥',
    color: '#ff8a3d',
    text: `${BURN_DAMAGE} HP par tour.`,
  },
  {
    id: 'bleed',
    name: 'Bleed (Saignement)',
    icon: '🩸',
    color: '#e05555',
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
    color: '#e0a83f',
    text: `La cible prend +${VULNERABLE_DAMAGE_BONUS_PERCENT}% de dégâts.`,
  },
  {
    id: 'stun',
    name: 'Stun',
    icon: '✦',
    color: '#ffe066',
    text: "Bloque totalement le personnage (ne peut ni attaquer, ni switcher, ni utiliser d'ability).",
  },
  {
    id: 'disarmed',
    name: 'Désarmé',
    icon: '⊘',
    color: '#b0b0b0',
    text: "Empêche d'effectuer une attaque.",
  },
  {
    id: 'silence-active',
    name: 'Silence actif',
    icon: '✕',
    color: '#ff6b6b',
    text: "Empêche l'utilisation des abilities actives.",
  },
  {
    id: 'silence-passive',
    name: 'Silence passif',
    icon: '✕',
    color: '#ff6b6b',
    text: 'Empêche le déclenchement des abilities passives.',
  },
  {
    id: 'silence-ultimate',
    name: 'Silence ultime',
    icon: '✕',
    color: '#ff6b6b',
    text: 'Bloque simultanément les abilities actives et passives.',
  },
  {
    id: 'critical',
    name: 'Critique',
    icon: '◎',
    color: '#ff4d4d',
    text: `${CRITICAL_STATUS_CHANCE_PERCENT}% de chance de proc → fait x${BASE_CRITICAL_MULTIPLIER} de dégâts.`,
  },
  {
    id: 'evasive',
    name: 'Esquive',
    icon: '»',
    color: '#7fc7f2',
    text: `${EVASIVE_STATUS_CHANCE_PERCENT}% de chance d'esquiver.`,
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
              <li key={entry.id} className="glossary-entry" style={{ ['--glossary-accent' as string]: entry.color }}>
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
