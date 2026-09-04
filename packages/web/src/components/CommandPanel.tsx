import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { GameState, PlayerId } from 'engine';
import { useHoverCard } from './HoverCard';
import { abilityOptions, attackOptions, switchOptions, type ActionOption } from './boardActions';
import type { GameConnection } from '../net/useGameConnection';

/**
 * Le switch n'ouvre plus de rubrique : il allume les personnages du banc sur le plateau
 * et se joue au clic sur la carte voulue (cf. `switchTargeting`). Une liste de noms sous
 * le personnage actif ne disait rien des PV, des statuts ni de qui on envoyait au feu.
 */
type Section = 'attack' | 'ability';

const SECTION_TITLE: Record<Section, string> = {
  attack: 'Attaques',
  ability: 'Capacités',
};

const SECTION_EMPTY: Record<Section, string> = {
  attack: 'Aucune attaque disponible.',
  ability: 'Pas de capacité activable.',
};

const SWITCH_EMPTY = 'Personne sur le banc.';

function OptionButton({ option, onPick }: { option: ActionOption; onPick: () => void }) {
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
        // La rubrique se referme sur le choix, sans attendre le nouvel état. Une capacité
        // gratuite (`endsTurn: false`) laisse le tour ouvert : le panneau serait resté
        // affiché par-dessus la projection de la carte qu'on vient justement de jouer.
        onPick();
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
  emptyHint,
  /** Le bouton agit directement (switch) : bloqué = rien à ouvrir, donc rien à cliquer. */
  blockedIsDisabled,
  active,
  onOpen,
}: {
  kind: Section | 'switch';
  icon: string;
  label: string;
  options: ActionOption[];
  emptyHint: string;
  blockedIsDisabled?: boolean;
  /** Rubrique dont le panneau contextuel est ouvert : le bouton reste allumé. */
  active?: boolean;
  onOpen: () => void;
}) {
  const empty = options.length === 0;
  const allBlocked = !empty && options.every((o) => o.disabledReason);
  const hint = empty ? emptyHint : allBlocked ? options[0]!.disabledReason ?? undefined : undefined;

  return (
    <button
      className={`cmd-button cmd-${kind}${empty || allBlocked ? ' cmd-button-blocked' : ''}${active ? ' cmd-button-active' : ''}`}
      onClick={onOpen}
      disabled={empty || (allBlocked && blockedIsDisabled)}
      title={hint}
    >
      <span className="cmd-button-icon">{icon}</span>
      <span className="cmd-button-label">{label}</span>
      {!empty && <span className="cmd-button-count">{options.length}</span>}
    </button>
  );
}

/** Marge minimale entre le panneau contextuel et les bords de l'écran. */
const POPOVER_MARGIN = 8;
/** En dessous de ça, le panneau ne montrerait plus une seule option : on ne descend pas. */
const POPOVER_MIN_HEIGHT = 132;

/**
 * Le plancher du panneau : la main du joueur occupe le bas de l'écran, le panneau s'arrête
 * au-dessus d'elle plutôt que de passer dessous. Même repère que le panneau d'inspection
 * (`HoverCard`), pour que les deux s'arrêtent sur la même ligne.
 */
function popoverFloor(): number {
  const dock = document.querySelector('.hand-dock')?.getBoundingClientRect().top;
  return Math.min(dock ?? window.innerHeight, window.innerHeight) - POPOVER_MARGIN;
}

/**
 * Panneau contextuel d'une rubrique. Trois raisons de le sortir du plateau par un portail
 * plutôt que de le poser en `absolute` sous la colonne de commandes :
 *
 * 1. `.arena` est en `overflow: hidden` (le combat ne défile jamais). Un personnage à
 *    quatre attaques -- Escanor -- produisait un panneau plus haut que la place restante
 *    sous la colonne, et l'arène en tranchait le bas : les deux dernières attaques étaient
 *    invisibles ET inatteignables, la liste ne défilant pas puisqu'elle tenait, elle, dans
 *    le panneau.
 * 2. Sorti du plateau, il se place en coordonnées ÉCRAN : il peut donc remonter le long de
 *    la colonne quand il n'y a plus la place en dessous, au lieu de déborder.
 * 3. Sa hauteur est plafonnée sur la place réellement disponible (mesurée, pas devinée),
 *    et la liste défile au-delà -- quel que soit le nombre d'attaques de la carte.
 */
function CommandPopover({
  section,
  title,
  anchorRef,
  onClose,
  children,
}: {
  section: Section;
  title: string;
  anchorRef: RefObject<HTMLDivElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Rendu hors écran au premier passage : on ne peut mesurer sa hauteur naturelle qu'une
  // fois monté, et le montrer avant d'avoir tranché le ferait sauter d'une position à l'autre.
  const [style, setStyle] = useState<CSSProperties>({ top: -9999, left: -9999, visibility: 'hidden' });

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;

      const floor = popoverFloor();
      const ceiling = POPOVER_MARGIN;
      const maxHeight = Math.max(POPOVER_MIN_HEIGHT, floor - ceiling);
      // Appliqué AVANT la mesure : c'est ce plafond qui décide si la liste défile, donc la
      // hauteur qu'on relit juste après est déjà la hauteur finale.
      panel.style.maxHeight = `${maxHeight}px`;
      const rect = panel.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();

      // Sous la colonne tant qu'il y a la place ; sinon le panneau remonte le long d'elle
      // jusqu'à se caler sur le plancher, et ne dépasse jamais le haut de l'écran.
      const below = anchorRect.bottom + POPOVER_MARGIN;
      const top = below + rect.height <= floor ? below : Math.max(ceiling, floor - rect.height);
      // Aligné sur le bord droit de la colonne (la bande sous les portraits est libre),
      // recadré dans la fenêtre pour ne jamais sortir par un côté.
      const left = Math.min(
        Math.max(POPOVER_MARGIN, anchorRect.right - rect.width),
        Math.max(POPOVER_MARGIN, window.innerWidth - rect.width - POPOVER_MARGIN)
      );

      // Même position qu'au tour d'avant : on garde l'objet précédent. `place()` est
      // rappelé à chaque rendu du panneau de commandes (la liste d'actions se recalcule en
      // continu), et un nouvel objet de style à chaque fois relançait un rendu pour rien.
      setStyle((prev) =>
        prev.top === top && prev.left === left && prev.maxHeight === maxHeight
          ? prev
          : { top, left, maxHeight }
      );
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // `children` en dépendance : la liste change de longueur (une attaque scellée, un
    // personnage de banc qui devient attaquant) et le panneau doit se replacer.
  }, [anchorRef, children]);

  return createPortal(
    <div ref={panelRef} className={`cmd-popover cmd-popover-${section}`} style={style}>
      <div className="cmd-sub-head">
        <span className="cmd-sub-title">{title}</span>
        <button className="cmd-back" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      {children}
    </div>,
    document.body
  );
}

/**
 * Panneau de commandes « façon Pokémon » : une grille 2×2 (attaque / capacité / switch /
 * passer) qui s'ouvre sur la liste détaillée de la rubrique choisie. Les objets et les
 * terrains ne sont plus ici -- ils se jouent depuis la main en bas de l'écran.
 *
 * Il n'est plus posé SOUS le personnage actif mais DEDANS : le plateau le passe en
 * `commands` à la `CharacterCard` de son actif, qui le loge dans la colonne d'infos de la
 * carte, sous les jauges de PV et de bouclier (cf. `.card-commands` dans la feuille de
 * style). Le composant n'a donc plus de largeur ni de cadre à lui -- il remplit la place
 * que la carte lui laisse.
 */
export function CommandPanel({
  state,
  you,
  conn,
  onStartSwitch,
}: {
  state: GameState;
  you: PlayerId;
  conn: GameConnection;
  /** Allume les personnages du banc sur le plateau et attend le clic sur l'un d'eux. */
  onStartSwitch: () => void;
}) {
  const [section, setSection] = useState<Section | null>(null);
  // La colonne de touches sert d'ancre au panneau contextuel, qui vit maintenant dans un
  // portail (hors du plateau) et se place donc en coordonnées écran.
  const gridRef = useRef<HTMLDivElement>(null);
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
          {state.result ? 'Partie terminée' : state.pendingChoice ? 'Choix en cours…' : "Tour de l'adversaire"}
        </span>
      </div>
    );
  }

  const attacks = attackOptions(state, you, conn);
  const abilities = abilityOptions(state, you, conn);
  const switches = switchOptions(state, you, conn);
  const optionsOf: Record<Section, ActionOption[]> = { attack: attacks, ability: abilities };

  // La rubrique ouverte ne REMPLACE plus la colonne : elle se pose à côté, en panneau
  // contextuel. La carte de personnage n'est jamais recouverte, et on garde sous les yeux
  // les trois autres commandes pendant qu'on choisit.
  const openOptions = section ? optionsOf[section] : null;

  return (
    <div className={`cmd-panel${section ? ` cmd-panel-open cmd-panel-${section}` : ''}`}>
      <div className="cmd-grid" ref={gridRef}>
        <RootButton
          kind="attack"
          icon="⚔️"
          label="Attaque"
          options={attacks}
          emptyHint={SECTION_EMPTY.attack}
          active={section === 'attack'}
          onOpen={() => setSection((prev) => (prev === 'attack' ? null : 'attack'))}
        />
        {/* Volontairement pas de « tir automatique » quand il n'y a qu'une option : une
            capacité est souvent coûteuse (un ultime une fois par partie, un allié qui paie
            100 PV) et la déclencher depuis le bouton la dépensait sans rien laisser lire. */}
        <RootButton
          kind="ability"
          icon="✨"
          label="Capacité"
          options={abilities}
          emptyHint={SECTION_EMPTY.ability}
          active={section === 'ability'}
          onOpen={() => setSection((prev) => (prev === 'ability' ? null : 'ability'))}
        />
        <RootButton
          kind="switch"
          icon="🔁"
          label="Switch"
          options={switches}
          emptyHint={SWITCH_EMPTY}
          blockedIsDisabled
          onOpen={() => {
            setSection(null);
            onStartSwitch();
          }}
        />
        <button className="cmd-button cmd-pass" onClick={() => conn.applyAction({ kind: 'pass' })}>
          <span className="cmd-button-icon">⏭️</span>
          <span className="cmd-button-label">Passer</span>
        </button>
      </div>
      {section && openOptions && (
        <CommandPopover
          section={section}
          title={SECTION_TITLE[section]}
          anchorRef={gridRef}
          onClose={() => setSection(null)}
        >
          <div className="cmd-options">
            {openOptions.length === 0 && <p className="cmd-options-empty">{SECTION_EMPTY[section]}</p>}
            {openOptions.map((option) => (
              <OptionButton key={option.key} option={option} onPick={() => setSection(null)} />
            ))}
          </div>
        </CommandPopover>
      )}
    </div>
  );
}
