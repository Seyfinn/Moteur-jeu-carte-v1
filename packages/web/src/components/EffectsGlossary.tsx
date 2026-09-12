import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
    text: `${POISON_FLAT_DAMAGE} HP + ${pct(POISON_PERCENT_OF_MAX_HP)} des HP max par tour. Traverse le bouclier.`,
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
    id: 'sealed',
    name: 'Scellé',
    icon: '✕',
    tone: 'debuff',
    text: "Une ability ou une attaque précise du personnage est définitivement désactivée. Les autres restent utilisables.",
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

/**
 * Recherche sans accents ni casse : « brulure » doit trouver « Brûlure », « esq » trouver
 * « Esquive ». On normalise les deux côtés plutôt que d'exiger du joueur la bonne graphie.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function GlossaryPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Échap ferme le volet : même sortie clavier que les autres panneaux du plateau. Sauf si
  // le champ de recherche a du texte : le premier Échap l'efface, le second ferme -- c'est
  // le comportement attendu d'un filtre, et ça évite de perdre le panneau en voulant juste
  // recommencer une recherche.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (searchRef.current && document.activeElement === searchRef.current && searchRef.current.value) {
        setQuery('');
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Le focus entre dans le champ de recherche à l'ouverture (on vient chercher UN effet
  // précis, autant pouvoir le taper tout de suite) et revient sur le bouton d'origine à la
  // fermeture, pour qu'un joueur au clavier ne retombe pas sur `body`.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    searchRef.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  const needle = fold(query.trim());
  const visible = useMemo(
    () => (needle ? ENTRIES.filter((e) => fold(`${e.name} ${e.text}`).includes(needle)) : ENTRIES),
    [needle]
  );
  const rulesVisible = !needle || BASE_RULES.some((rule) => fold(rule).includes(needle));

  const jumpTo = (id: string) => {
    document.getElementById(`glossary-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Portail vers `document.body` : le bouton qui ouvre ce panneau vit dans `.board-header`,
  // qui porte à la fois un `clip-path` (biseau du HUD) et un `backdrop-filter` -- les deux
  // créent un bloc de confinement pour tout descendant en `position: fixed`. Sans portail,
  // le panneau restait un enfant de `.board-header` et se retrouvait rogné par son biseau
  // et cadré sur sa boîte (une simple barre en haut de l'écran) au lieu du plein écran :
  // c'est tout l'effet « cassé/rogné en haut à droite » signalé. Le portail fait sortir le
  // panneau de cette sous-arborescence, quoi que `.board-header` fasse par ailleurs.
  return createPortal(
    <div className="modal-backdrop glossary-backdrop" onClick={onClose}>
      <div
        className="modal glossary-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glossary-header">
          <h3 id="glossary-title">Glossaire des effets</h3>
          <button className="hover-card-close" onClick={onClose} aria-label="Fermer le glossaire (Échap)" title="Fermer (Échap)">
            ×
          </button>
          <div className="glossary-search">
            <span className="glossary-search-icon" aria-hidden="true">
              🔍
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer un effet (poison, silence, esquive…)"
              aria-label="Filtrer les effets"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button className="glossary-search-clear" onClick={() => setQuery('')} aria-label="Effacer le filtre" title="Effacer">
                ×
              </button>
            )}
          </div>
          {/* Sommaire : une puce par effet, à la couleur de son badge, qui fait défiler
              jusqu'à l'entrée. Masqué pendant un filtre -- la liste filtrée EST déjà le
              sommaire, et deux rangées de puces pour trois résultats ne servent à rien. */}
          {!needle && (
            <nav className="glossary-toc" aria-label="Sommaire du glossaire">
              {ENTRIES.map((entry) => (
                <button
                  key={entry.id}
                  className="glossary-toc-chip"
                  style={{ ['--glossary-accent' as string]: STATUS_TONE_COLOR[entry.tone] }}
                  onClick={() => jumpTo(entry.id)}
                >
                  <span aria-hidden="true">{entry.icon}</span> {entry.name}
                </button>
              ))}
              <button className="glossary-toc-chip glossary-toc-rules" onClick={() => jumpTo('rules')}>
                Règles de base
              </button>
            </nav>
          )}
        </header>

        <div className="glossary-scroll">
          {visible.length === 0 && !rulesVisible && (
            <p className="glossary-empty" role="status">
              Aucun effet ne correspond à « {query.trim()} ».
            </p>
          )}
          <ul className="glossary-list">
            {visible.map((entry) => (
              <li
                key={entry.id}
                id={`glossary-${entry.id}`}
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

          {rulesVisible && (
            <section className="glossary-rules" id="glossary-rules">
              <h4>Règles de base</h4>
              {BASE_RULES.map((rule) => (
                <p key={rule}>{rule}</p>
              ))}
            </section>
          )}
          {needle && (
            <p className="glossary-result-count" role="status">
              {visible.length === 0 ? 'Aucun effet' : visible.length === 1 ? '1 effet' : `${visible.length} effets`} sur {ENTRIES.length}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
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
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Le libellé disparaît sous 760px : la barre du haut y est déjà pleine, et c'est
            l'indicateur de tour qui doit garder la place. */}
        📖<span className="glossary-button-label"> Effets</span>
      </button>
      {open && <GlossaryPanel onClose={() => setOpen(false)} />}
    </>
  );
}
