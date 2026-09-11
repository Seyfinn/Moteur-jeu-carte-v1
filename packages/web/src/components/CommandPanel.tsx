import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { GameState, PlayerId } from 'engine';
import { abilityOptions, attackOptions, switchOptions, type ActionOption } from './boardActions';
import { usePointerCoarse } from '../hooks/usePointerCoarse';
import type { GameConnection } from '../net/useGameConnection';

/**
 * Le switch n'ouvre une rubrique QUE lorsqu'il est fermé : il allume normalement les
 * personnages du banc sur le plateau et se joue au clic sur la carte voulue (cf.
 * `switchTargeting`) -- une liste de noms sous le personnage actif ne disait rien des PV,
 * des statuts ni de qui on envoyait au feu. Mais quand Arène ou un enchaînement l'interdit,
 * la touche était juste morte : un `title` au survol que le tactile ne verra jamais. La
 * rubrique sert alors uniquement à lire POURQUOI, personnage par personnage.
 */
type Section = 'attack' | 'ability' | 'switch';

const SECTION_TITLE: Record<Section, string> = {
  attack: 'Attaques',
  ability: 'Capacités',
  switch: 'Switch',
};

const SECTION_EMPTY: Record<Section, string> = {
  attack: 'Aucune attaque disponible.',
  ability: 'Pas de capacité activable.',
  switch: 'Personne sur le banc.',
};

const OPTION_SELECTOR = '.cmd-option:not(:disabled)';

function OptionButton({ option, onPick }: { option: ActionOption; onPick: () => void }) {
  const blocked = Boolean(option.disabledReason);

  return (
    <button
      className={`cmd-option${blocked ? ' blocked' : ''}`}
      disabled={blocked}
      title={option.disabledReason ?? undefined}
      onClick={() => {
        // La rubrique se referme sur le choix, sans attendre le nouvel état. Une capacité
        // gratuite (`endsTurn: false`) laisse le tour ouvert : le panneau serait resté
        // affiché par-dessus la projection de la carte qu'on vient justement de jouer.
        onPick();
        option.run();
      }}
    >
      <span className="cmd-option-head">
        <span className="cmd-option-main">
          <span className="cmd-option-label">{option.label}</span>
          {option.sub && <span className="cmd-option-sub">{option.sub}</span>}
        </span>
        {option.detail && (
          <span className={`cmd-option-detail${option.trend ? ` cmd-option-detail-${option.trend}` : ''}`}>
            <span className="cmd-option-detail-value">{option.detail}</span>
            {option.detailNote && <span className="cmd-option-detail-note">{option.detailNote}</span>}
          </span>
        )}
      </span>
      {option.tags && option.tags.length > 0 && (
        <span className="cmd-option-tags">
          {option.tags.map((tag) => (
            <span key={tag.text} className={`cmd-option-tag${tag.state ? ` cmd-option-tag-${tag.state}` : ''}`}>
              {tag.text}
            </span>
          ))}
        </span>
      )}
      {/* Le texte de la carte, tel quel : le joueur lit ce qu'il va jouer sans survoler. */}
      {option.description && <span className="cmd-option-desc">{option.description}</span>}
      {/* La raison du grisage, en clair sous l'option : le `title` reste pour le survol et
          les tests, mais un joueur sur tactile n'a pas de survol du tout. */}
      {blocked && (
        <span className="cmd-option-reason" role="note">
          <span className="cmd-option-reason-icon" aria-hidden="true">
            ⊘
          </span>
          {option.disabledReason}
        </span>
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
  active,
  onOpen,
}: {
  kind: Section;
  icon: string;
  label: string;
  options: ActionOption[];
  emptyHint: string;
  /** Rubrique dont le panneau contextuel est ouvert : le bouton reste allumé. */
  active?: boolean;
  /** Reçoit la touche cliquée : c'est à elle que le focus revient quand la rubrique se ferme. */
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const coarse = usePointerCoarse();
  const empty = options.length === 0;
  const playable = options.filter((o) => !o.disabledReason).length;
  const allBlocked = !empty && playable === 0;
  const hint = empty ? emptyHint : allBlocked ? options[0]!.disabledReason ?? undefined : undefined;
  // Sur tactile, une touche `disabled` est une touche muette : elle reste tapable et ouvre la
  // rubrique, qui affiche alors son message « rien à faire ici » -- c'est le seul retour
  // qu'un doigt puisse obtenir, là où la souris lit le `title`.
  const disabled = empty && !coarse;

  return (
    <button
      className={`cmd-button cmd-${kind}${empty || allBlocked ? ' cmd-button-blocked' : ''}${active ? ' cmd-button-active' : ''}`}
      onClick={(e) => onOpen(e.currentTarget)}
      disabled={disabled}
      title={hint}
      aria-haspopup="dialog"
      aria-expanded={Boolean(active)}
      aria-label={hint ? `${label} — ${hint}` : label}
    >
      <span className="cmd-button-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="cmd-button-label">{label}</span>
      {/* Le nombre d'options réellement jouables, pas le total : « 0 » sur une touche
          allumée dit tout de suite qu'il n'y a rien à faire ici ce tour. */}
      {!empty && (
        <span className={`cmd-button-count${playable === 0 ? ' cmd-button-count-none' : ''}`}>{playable}</span>
      )}
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
 *
 * Il se comporte comme un petit dialogue : le focus y entre à l'ouverture (première option
 * jouable), les flèches circulent entre les options, Échap et la croix le ferment en
 * rendant le focus à la touche d'origine, et un clic n'importe où ailleurs le replie.
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
  /** `restoreFocus` : la fermeture vient du clavier ou de la croix, la touche reprend le focus. */
  onClose: (restoreFocus: boolean) => void;
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

  // Le focus entre dans le panneau à l'ouverture : sans ça, Tab depuis la touche repartait
  // dans le plateau et le clavier n'atteignait jamais la liste. Première option jouable,
  // sinon la croix -- il y a toujours quelque chose à focaliser, même sur une liste vide.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(OPTION_SELECTOR) ?? panel.querySelector<HTMLElement>('.cmd-back');
    first?.focus({ preventScroll: true });
    // Une seule fois, à l'ouverture de CETTE rubrique : re-focaliser à chaque rendu volerait
    // le focus au joueur qui descend la liste pendant qu'elle se recalcule.
  }, [section]);

  // Un clic hors du panneau ET hors de la colonne le replie (la colonne gère elle-même le
  // clic sur sa touche : rouvrir ou basculer de rubrique). En capture, pour passer avant un
  // gestionnaire du plateau qui arrêterait la propagation.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorRef, onClose]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (current === -1) next = e.key === 'ArrowDown' ? 0 : items.length - 1;
    else next = (current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      className={`cmd-popover cmd-popover-${section}`}
      style={style}
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <div className="cmd-sub-head">
        <span className="cmd-sub-title">{title}</span>
        <button className="cmd-back" onClick={() => onClose(true)} aria-label="Fermer" title="Fermer (Échap)">
          ×
        </button>
      </div>
      {children}
    </div>,
    document.body
  );
}

/**
 * Panneau de commandes « façon Pokémon » : une colonne de touches (attaque / capacité /
 * switch / passer) qui s'ouvre sur la liste détaillée de la rubrique choisie. Les objets et
 * les terrains ne sont plus ici -- ils se jouent depuis la main en bas de l'écran.
 *
 * Il n'est plus posé SOUS le personnage actif mais à côté : le plateau le dresse à droite
 * du portrait de l'actif, sur la hauteur de la carte (cf. `.cmd-panel` dans la feuille de
 * style). Le composant n'a donc pas de cadre à lui -- il remplit la colonne qu'on lui laisse.
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
  // La touche qui a ouvert la rubrique : c'est à elle que le focus revient à la fermeture au
  // clavier, sinon il tombait sur `body` et la navigation par Tab repartait de zéro.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const isMyTurn = state.activePlayerId === you && state.phase === 'main' && !state.pendingChoice;

  const close = useCallback((restoreFocus: boolean) => {
    setSection(null);
    if (restoreFocus) openerRef.current?.focus({ preventScroll: true });
  }, []);

  const toggle = (next: Section, button: HTMLButtonElement) => {
    openerRef.current = button;
    setSection((prev) => (prev === next ? null : next));
  };

  // Une rubrique ouverte doit se refermer dès que le tour change ou qu'un choix s'ouvre,
  // sinon le panneau reste bloqué sur une liste d'actions devenues injouables.
  useEffect(() => {
    if (!isMyTurn) setSection(null);
  }, [isMyTurn]);

  // Échap ferme la rubrique même si le focus est ailleurs (le panneau a son propre
  // gestionnaire quand il tient le focus, celui-ci couvre le reste de la fenêtre).
  useEffect(() => {
    if (section === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section, close]);

  if (!isMyTurn) {
    return (
      <div className="cmd-panel cmd-panel-waiting" role="status" aria-live="polite">
        <span className="cmd-waiting-dot" aria-hidden="true" />
        <span className="cmd-waiting-label">
          {state.result ? 'Partie terminée' : state.pendingChoice ? 'Choix en cours…' : "Tour de l'adversaire"}
        </span>
      </div>
    );
  }

  const attacks = attackOptions(state, you, conn);
  const abilities = abilityOptions(state, you, conn);
  const switches = switchOptions(state, you, conn);
  const optionsOf: Record<Section, ActionOption[]> = { attack: attacks, ability: abilities, switch: switches };
  const switchSealed = switches.length > 0 && switches.every((o) => o.disabledReason);

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
          onOpen={(button) => toggle('attack', button)}
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
          onOpen={(button) => toggle('ability', button)}
        />
        <RootButton
          kind="switch"
          icon="🔁"
          label="Switch"
          options={switches}
          emptyHint={SECTION_EMPTY.switch}
          active={section === 'switch'}
          onOpen={(button) => {
            // Switch possible : le choix se fait sur le plateau, la rubrique n'a rien à
            // dire. Scellé (ou banc vide sur tactile) : la rubrique s'ouvre pour dire pourquoi.
            if (switches.length > 0 && !switchSealed) {
              setSection(null);
              onStartSwitch();
              return;
            }
            toggle('switch', button);
          }}
        />
        {/* Fin de tour : volontairement en retrait des trois actions, séparée par un filet
            et dessinée en touche « fantôme » -- c'est celle qu'on ne veut pas presser par
            réflexe. */}
        <span className="cmd-divider" aria-hidden="true" />
        <button
          className="cmd-button cmd-pass"
          onClick={() => conn.applyAction({ kind: 'pass' })}
          title="Terminer le tour sans agir"
        >
          <span className="cmd-button-icon" aria-hidden="true">
            ⏭️
          </span>
          <span className="cmd-button-label">Passer</span>
        </button>
      </div>
      {section && openOptions && (
        <CommandPopover section={section} title={SECTION_TITLE[section]} anchorRef={gridRef} onClose={close}>
          <div className="cmd-options">
            {openOptions.length === 0 && <p className="cmd-options-empty">{SECTION_EMPTY[section]}</p>}
            {openOptions.map((option) => (
              <OptionButton key={option.key} option={option} onPick={() => close(false)} />
            ))}
          </div>
        </CommandPopover>
      )}
    </div>
  );
}
