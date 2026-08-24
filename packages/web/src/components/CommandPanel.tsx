import { useEffect, useState } from 'react';
import type { GameState, PlayerId } from 'engine';
import { useHoverCard } from './HoverCard';
import { abilityOptions, attackOptions, switchOptions, type ActionOption } from './boardActions';
import type { GameConnection } from '../net/useGameConnection';

type Section = 'attack' | 'ability' | 'switch';

const SECTION_TITLE: Record<Section, string> = {
  attack: 'Attaques',
  ability: 'Capacités',
  switch: 'Changer de personnage',
};

const SECTION_EMPTY: Record<Section, string> = {
  attack: 'Aucune attaque disponible.',
  ability: 'Pas de capacité activable.',
  switch: 'Personne sur le banc.',
};

function OptionButton({ option }: { option: ActionOption }) {
  const hover = useHoverCard();
  const blocked = Boolean(option.disabledReason);

  return (
    <button
      className={`cmd-option${blocked ? ' blocked' : ''}`}
      disabled={blocked}
      title={option.disabledReason ?? undefined}
      onClick={() => {
        // Le bouton disparaît en même temps que la rubrique : sans ça son `onMouseLeave`
        // ne partirait jamais et l'encart de description resterait figé à l'écran.
        hover.hide();
        option.run();
      }}
      onMouseEnter={(e) => option.hover && hover.show(option.hover, e.currentTarget)}
      onMouseLeave={hover.hide}
    >
      <span className="cmd-option-main">
        <span className="cmd-option-label">{option.label}</span>
        {option.sub && <span className="cmd-option-sub">{option.sub}</span>}
      </span>
      {blocked ? (
        <span className="cmd-option-detail blocked">{option.disabledReason}</span>
      ) : (
        option.detail && <span className="cmd-option-detail">{option.detail}</span>
      )}
    </button>
  );
}

function RootButton({
  kind,
  icon,
  label,
  options,
  onOpen,
}: {
  kind: Section;
  icon: string;
  label: string;
  options: ActionOption[];
  onOpen: () => void;
}) {
  const empty = options.length === 0;
  const allBlocked = !empty && options.every((o) => o.disabledReason);
  const hint = empty ? SECTION_EMPTY[kind] : allBlocked ? options[0]!.disabledReason ?? undefined : undefined;

  return (
    <button
      className={`cmd-button cmd-${kind}${empty || allBlocked ? ' cmd-button-blocked' : ''}`}
      onClick={onOpen}
      disabled={empty}
      title={hint}
    >
      <span className="cmd-button-icon">{icon}</span>
      <span className="cmd-button-label">{label}</span>
      {!empty && <span className="cmd-button-count">{options.length}</span>}
    </button>
  );
}

/**
 * Panneau de commandes « façon Pokémon », posé directement sous le personnage actif :
 * une grille 2×2 (attaque / capacité / switch / passer) qui s'ouvre sur la liste
 * détaillée de la rubrique choisie. Les objets et les terrains ne sont plus ici -- ils se
 * jouent depuis la main en bas de l'écran.
 */
export function CommandPanel({ state, you, conn }: { state: GameState; you: PlayerId; conn: GameConnection }) {
  const [section, setSection] = useState<Section | null>(null);
  const isMyTurn = state.activePlayerId === you && state.phase === 'main' && !state.pendingChoice;

  // Une rubrique ouverte doit se refermer dès que le tour change ou qu'un choix s'ouvre,
  // sinon le panneau reste bloqué sur une liste d'actions devenues injouables.
  useEffect(() => {
    if (!isMyTurn) setSection(null);
  }, [isMyTurn]);

  useEffect(() => {
    if (section === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSection(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section]);

  if (!isMyTurn) {
    return (
      <div className="cmd-panel cmd-panel-waiting">
        <span className="cmd-waiting-label">
          {state.pendingChoice ? 'Choix en cours…' : "Tour de l'adversaire"}
        </span>
      </div>
    );
  }

  const attacks = attackOptions(state, you, conn);
  const abilities = abilityOptions(state, you, conn);
  const switches = switchOptions(state, you, conn);
  const optionsOf: Record<Section, ActionOption[]> = { attack: attacks, ability: abilities, switch: switches };

  if (section) {
    const options = optionsOf[section];
    return (
      <div className={`cmd-panel cmd-panel-open cmd-panel-${section}`}>
        <div className="cmd-sub-head">
          <button className="cmd-back" onClick={() => setSection(null)} aria-label="Retour">
            ←
          </button>
          <span className="cmd-sub-title">{SECTION_TITLE[section]}</span>
        </div>
        <div className="cmd-options">
          {options.length === 0 && <p className="cmd-options-empty">{SECTION_EMPTY[section]}</p>}
          {options.map((option) => (
            <OptionButton key={option.key} option={option} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cmd-panel">
      <div className="cmd-grid">
        <RootButton kind="attack" icon="⚔️" label="Attaque" options={attacks} onOpen={() => setSection('attack')} />
        {/* Volontairement pas de « tir automatique » quand il n'y a qu'une option : une
            capacité est souvent coûteuse (un ultime une fois par partie, un allié qui paie
            100 PV) et la déclencher depuis le bouton la dépensait sans rien laisser lire. */}
        <RootButton kind="ability" icon="✨" label="Capacité" options={abilities} onOpen={() => setSection('ability')} />
        <RootButton kind="switch" icon="🔁" label="Switch" options={switches} onOpen={() => setSection('switch')} />
        <button className="cmd-button cmd-pass" onClick={() => conn.applyAction({ kind: 'pass' })}>
          <span className="cmd-button-icon">⏭️</span>
          <span className="cmd-button-label">Passer</span>
        </button>
      </div>
    </div>
  );
}
