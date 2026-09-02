import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_MAX_CHARACTER_HAND,
  DEFAULT_MAX_OBJECTS_PER_TURN,
  DEFAULT_MAX_TERRAINS_PER_TURN,
  getMaxObjectsPerTurn,
  getMaxTerrainsPerTurn,
  otherPlayer,
  type CharacterInstance,
  type GameState,
  type PlayerId,
  type PlayerState,
} from 'engine';
import { characterVitals, CharacterCard } from './CharacterCard';
import { CardFrame } from './CardFrame';
import { ChoiceCountdownBadge, ChoiceModal } from './ChoiceModal';
import { switchTargeting, TargetingBar, useBoardTargeting, type BoardTargeting } from './Targeting';
import { CommandPanel } from './CommandPanel';
import { EffectsGlossaryButton } from './EffectsGlossary';
import { EventLog } from './EventLog';
import { GraveyardPile } from './GraveyardPile';
import { InitiativeWheel } from './InitiativeWheel';
import { MatchOverModal } from './MatchOverModal';
import { ProcWheels } from './ProcWheel';
import { CardSpotlights } from './CardSpotlight';
import { CharacterHand, OpponentHand, PlayerHand } from './HandFan';
import { COMBAT_PREVIEW_DELAY_MS, DECK_PREVIEW_DELAY_MS, useCardInspect, useHoverCard } from './HoverCard';
import { characterDetailBody, terrainDetailBody } from './cardDetails';
import {
  abilityOptionsFor,
  attachedObjectsOf,
  characterName,
  objectDenial,
  switchOptions,
  terrainDenial,
  terrainName,
  type ActionOption,
} from './boardActions';
import { KoFlights } from './KoFlight';
import { useGameEvents, type CharacterBadge, type CharacterImpact } from './gameEvents';
import { TableEventBanners } from './gameEventBadges';
import type { GameConnection } from '../net/useGameConnection';

/**
 * Abandon. Disponible en permanence, y compris pendant le tour de l'adversaire : c'est
 * précisément là qu'on décide de quitter une partie (et le bouton « Quitter » d'à côté ne
 * fait que rendre la main au lobby, sans conclure la partie pour l'autre joueur).
 * Deux temps, parce que c'est irréversible et que le bouton vit dans la barre du haut.
 */
function ForfeitButton({ onForfeit }: { onForfeit: () => void }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        className="board-leave"
        onClick={() => setConfirming(true)}
        title="Abandonner : la victoire revient immédiatement à l'adversaire"
      >
        Abandonner
      </button>
    );
  }

  return (
    <span className="board-forfeit-confirm">
      Abandonner ?
      <button className="board-leave danger" onClick={onForfeit}>
        Oui
      </button>
      <button className="board-leave" onClick={() => setConfirming(false)}>
        Non
      </button>
    </span>
  );
}

function ActionErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  // `onDismiss` est une lambda recréée à chaque rendu du plateau, et le plateau se redessine
  // à chaque état reçu du serveur : la garder en dépendance relançait le compte à rebours au
  // lieu de le laisser courir, et la bannière ne partait plus jamais d'elle-même.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <p className="error action-error">
      {message}
      <button className="action-error-dismiss" onClick={onDismiss} aria-label="Fermer">
        ×
      </button>
    </p>
  );
}

/** Carte de terrain d'un camp, posée au centre du plateau contre son personnage actif. */
function TerrainSlot({ player, side }: { player: PlayerState; side: 'self' | 'opponent' }) {
  const terrainId = player.activeTerrainInstanceId;
  const terrain = terrainId ? player.terrains[terrainId] : undefined;
  const name = terrain ? terrainName(terrain.cardId) : 'Aucun terrain';
  const inspect = useCardInspect({
    title: name,
    card: { cardId: terrain?.cardId ?? '', kind: 'terrain', name },
    body: terrain ? terrainDetailBody(terrain.cardId) : null,
  });

  return (
    <div className={`terrain-slot-zone ${side}`}>
      <span className="zone-label">Terrain</span>
      {terrain ? (
        <CardFrame
          cardId={terrain.cardId}
          kind="terrain"
          name={name}
          size="normal"
          {...inspect}
          // La durée restante d'un terrain commande la plupart des décisions autour de
          // lui, et elle n'était lisible qu'en comptant les tours à la main.
          footer={
            <span className="terrain-remaining">
              {terrain.remainingTurns === undefined
                ? '∞'
                : `${terrain.remainingTurns} tour${terrain.remainingTurns > 1 ? 's' : ''}`}
            </span>
          }
        />
      ) : (
        // Emplacement vide dessiné aux cotes d'une vraie carte : la ligne centrale garde
        // sa symétrie, terrain posé ou non, au lieu de se décaler à chaque pose.
        <div className="terrain-slot-empty">
          <span className="terrain-slot-empty-icon" aria-hidden="true">
            🗺️
          </span>
          <span className="terrain-slot-empty-label">Poser un Terrain</span>
        </div>
      )}
    </div>
  );
}

/**
 * Distorsion de chaleur de la Brûlure. Un `filter` CSS ne sait pas réfracter : il faut un
 * vrai filtre SVG (turbulence + déplacement), dont la graine est animée pour que les
 * vagues ondulent au lieu d'être figées.
 *
 * Déclaré une seule fois pour tout le plateau et référencé par `filter: url(#fx-heat-haze)`
 * sur l'illustration de chaque carte qui brûle -- un `<svg>` par carte multiplierait le
 * même filtre autant de fois qu'il y a de brûlés.
 */
function HeatHazeFilter() {
  return (
    <svg className="fx-svg-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="fx-heat-haze" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.05" numOctaves="2" seed="3" result="noise">
            <animate attributeName="baseFrequency" dur="4s" values="0.014 0.05;0.02 0.075;0.014 0.05" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/** Identité d'un camp, telle que le bandeau de combat la donne à lire. */
interface CombatantHud {
  label: string;
  alive: number;
  total: number;
  /** Mode Pioche : éliminations subies par ce camp. À DRAW_MODE_ELIMINATIONS_TO_WIN, il perd. */
  lost: number | null;
  isTheirTurn: boolean;
}

/**
 * Bandeau de combat posé AU-DESSUS du personnage actif : nom du camp à gauche, jauge de PV
 * à droite. C'est le pendant de `hideName`/`hideVitals` sur la carte -- au format portrait
 * géant, tout ce texte volait la place de l'illustration, qui est justement ce que ce
 * format met en avant.
 */
function CombatHud({ hud, char, side }: { hud: CombatantHud; char: CharacterInstance | undefined; side: 'self' | 'opponent' }) {
  const vitals = char ? characterVitals(char) : null;

  return (
    <div className={`combat-hud ${side}${hud.isTheirTurn ? ' active-turn' : ''}`}>
      <div className="combat-hud-identity">
        {/* Diode de tour : elle s'allume pour le camp qui a la main. */}
        <span className="combat-hud-diode" aria-hidden="true" />
        <span className="combat-hud-name">{hud.label}</span>
        {hud.lost !== null && (
          <span
            className={`combat-hud-elims${hud.lost >= DRAW_MODE_ELIMINATIONS_TO_WIN - 2 ? ' critical' : ''}`}
            title={`Personnages perdus. À ${DRAW_MODE_ELIMINATIONS_TO_WIN}, ce camp perd la partie.`}
          >
            ☠ {hud.lost}/{DRAW_MODE_ELIMINATIONS_TO_WIN}
          </span>
        )}
        <span className="combat-hud-roster" title="Personnages encore en jeu">
          {hud.alive}/{hud.total}
        </span>
      </div>
      {vitals ? (
        // Le liseré bleu autour de la jauge matérialise le bouclier : une réserve à manger
        // AVANT les PV, donc dessinée autour d'eux plutôt qu'à côté.
        <div
          className={`combat-hud-hp${vitals.shieldTotal > 0 ? ' shielded' : ''}`}
          style={{ ['--hp-hue' as string]: Math.round(vitals.pct * 1.2) }}
          title={vitals.shieldTotal > 0 ? `${vitals.shieldTotal} points de bouclier` : undefined}
        >
          <div className={`combat-hud-hp-fill${vitals.pct <= 25 ? ' low' : ''}`} style={{ width: `${vitals.pct}%` }} />
          <span className="combat-hud-hp-text">
            {vitals.currentHP} / {char!.currentMaxHP}
            {vitals.shieldTotal > 0 && <em className="combat-hud-shield">+{vitals.shieldTotal} 🛡</em>}
          </span>
        </div>
      ) : (
        <div className="combat-hud-hp empty" />
      )}
    </div>
  );
}

function ActiveSlot({
  char,
  badges,
  side,
  targeting,
  state,
  actions,
  impact,
  hud,
}: {
  char: CharacterInstance | undefined;
  badges?: CharacterBadge[];
  side: 'self' | 'opponent';
  targeting: BoardTargeting | null;
  state: GameState;
  /** Colonne de commandes dressée à droite de la carte -- côté joueur uniquement. */
  actions?: ReactNode;
  impact?: CharacterImpact;
  hud: CombatantHud;
}) {
  return (
    <div className={`active-slot ${side}${actions ? ' commanded' : ''}`}>
      <CombatHud hud={hud} char={char} side={side} />
      <div className="active-stage">
        {char ? (
          /* La clé est indispensable ici : le slot garde sa place dans l'arbre quand l'actif
             change, donc sans elle React réutilise le même CharacterCard et son compteur de
             dégâts compare les PV de deux personnages différents -- le nouvel arrivant
             récoltait un « -N » et un flash de dégâts qu'il n'a jamais subis. */
          <CharacterCard
            key={char.instanceId}
            char={char}
            isActive
            isKOable
            size="large"
            orientation="portrait"
            badges={badges}
            targetable={targeting?.options.has(char.instanceId)}
            targeted={targeting?.selected.includes(char.instanceId)}
            onTarget={() => targeting?.toggle(char.instanceId)}
            attachedObjects={attachedObjectsOf(state, char)}
            state={state}
            impact={impact}
            // L'ennemi est toujours en face : le joueur bondit vers la droite, l'adversaire
            // vers la gauche.
            facing={side === 'self' ? 'right' : 'left'}
            hideName
            hideVitals
          />
        ) : (
          <div className="active-slot-empty">Aucun personnage actif</div>
        )}
        {actions}
      </div>
    </div>
  );
}

/**
 * Mini-menu d'un personnage de réserve : de quoi le renvoyer au combat ou déclencher à
 * distance une capacité marquée `usableFromBench`, sans passer par une barre d'action.
 */
function BenchMenu({
  name,
  options,
  onClose,
  onDetails,
}: {
  name: string;
  options: ActionOption[];
  onClose: () => void;
  onDetails: () => void;
}) {
  const hover = useHoverCard();

  return (
    <div className="bench-menu">
      <div className="bench-menu-head">{name}</div>
      {options.length === 0 && <p className="bench-menu-empty">Rien à déclencher d'ici.</p>}
      {options.map((option) => (
        <button
          key={option.key}
          className={`bench-menu-item${option.disabledReason ? ' blocked' : ''}`}
          disabled={Boolean(option.disabledReason)}
          title={option.disabledReason ?? undefined}
          onClick={() => {
            // Le mini-menu se referme sur l'action : son `onMouseLeave` ne partira pas, donc
            // l'encart de description doit être fermé à la main.
            hover.hide();
            option.run();
            onClose();
          }}
          onMouseEnter={(e) => option.hover && hover.show(option.hover, e.currentTarget)}
          onMouseLeave={hover.hide}
        >
          <span className="bench-menu-item-label">{option.label}</span>
          {option.disabledReason ? (
            <span className="bench-menu-item-detail blocked">{option.disabledReason}</span>
          ) : (
            option.detail && <span className="bench-menu-item-detail">{option.detail}</span>
          )}
        </button>
      ))}
      <button
        className="bench-menu-item ghost"
        onClick={() => {
          onDetails();
          onClose();
        }}
      >
        <span className="bench-menu-item-label">🔍 Voir la carte</span>
      </button>
    </div>
  );
}

function SelfBenchCard({
  char,
  badges,
  state,
  you,
  conn,
  turnGate,
  isOpen,
  onToggle,
  onClose,
  targeting,
  impact,
}: {
  char: CharacterInstance;
  badges?: CharacterBadge[];
  state: GameState;
  you: PlayerId;
  conn: GameConnection;
  turnGate: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  targeting: BoardTargeting | null;
  impact?: CharacterImpact;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const name = characterName(char.cardId);
  const inspect = useCardInspect({
    id: char.instanceId,
    title: name,
    card: { cardId: char.cardId, kind: 'character', name },
    body: characterDetailBody(char.cardId, char, state),
  });

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen, onClose]);

  // Le tour de l'adversaire est la raison dominante : elle passe devant un stun ou une
  // limite d'usage, qui n'apprendraient rien tant que la main n'est pas à nous.
  const gate = (option: ActionOption): ActionOption => ({
    ...option,
    disabledReason: turnGate ?? option.disabledReason,
  });
  const options = [
    ...switchOptions(state, you, conn)
      .filter((option) => option.key === char.instanceId)
      .map((option) => gate({ ...option, label: '🔁 Envoyer au combat', detail: undefined })),
    ...abilityOptionsFor(state, you, conn, char.instanceId).map((option) =>
      gate({ ...option, label: `✨ ${option.label}`, sub: undefined })
    ),
  ];

  return (
    <div className="bench-card-wrap" ref={wrapRef}>
      <CharacterCard
        char={char}
        isActive={false}
        isKOable
        size="small"
        orientation="landscape"
        badges={badges}
        selected={isOpen}
        onSelect={onToggle}
        targetable={targeting?.options.has(char.instanceId)}
        targeted={targeting?.selected.includes(char.instanceId)}
        onTarget={() => targeting?.toggle(char.instanceId)}
        attachedObjects={attachedObjectsOf(state, char)}
        state={state}
        impact={impact}
      />
      {isOpen && <BenchMenu name={name} options={options} onClose={onClose} onDetails={inspect.onClick} />}
    </div>
  );
}

function BenchRow({
  player,
  isSelf,
  badgesByCharacter,
  state,
  you,
  conn,
  turnGate,
  targeting,
  impactsByCharacter,
}: {
  player: PlayerState;
  isSelf: boolean;
  badgesByCharacter: Map<string, CharacterBadge[]>;
  state: GameState;
  you: PlayerId;
  conn: GameConnection;
  turnGate: string | null;
  targeting: BoardTargeting | null;
  impactsByCharacter: Map<string, CharacterImpact>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Un ciblage qui démarre referme le mini-menu : il recouvre les cartes voisines, donc
  // celles qu'on est justement en train de demander au joueur de comparer.
  const targetingOn = Boolean(targeting);
  useEffect(() => {
    if (targetingOn) setOpenId(null);
  }, [targetingOn]);
  const bench = player.benchCharacterInstanceIds
    .map((id) => player.characters[id])
    .filter((char): char is CharacterInstance => char !== undefined);

  // Un mini-menu ouvert sur un personnage qui vient de partir au combat (ou de mourir)
  // n'a plus de carte sous lui : le refermer plutôt que le laisser flotter.
  useEffect(() => {
    if (openId && !player.benchCharacterInstanceIds.includes(openId)) setOpenId(null);
  }, [openId, player.benchCharacterInstanceIds]);

  return (
    <div className={`bench-column${isSelf ? ' self' : ' opponent'}`}>
      {bench.length === 0 && <span className="bench-column-empty">Banc vide</span>}
      {bench.map((char) =>
        isSelf ? (
          <SelfBenchCard
            key={char.instanceId}
            char={char}
            badges={badgesByCharacter.get(char.instanceId)}
            state={state}
            you={you}
            conn={conn}
            turnGate={turnGate}
            isOpen={openId === char.instanceId}
            onToggle={() => setOpenId((prev) => (prev === char.instanceId ? null : char.instanceId))}
            onClose={() => setOpenId(null)}
            targeting={targeting}
            impact={impactsByCharacter.get(char.instanceId)}
          />
        ) : (
          <div className="bench-card-wrap" key={char.instanceId}>
            <CharacterCard
              char={char}
              isActive={false}
              isKOable
              size="small"
              orientation="landscape"
              badges={badgesByCharacter.get(char.instanceId)}
              targetable={targeting?.options.has(char.instanceId)}
              targeted={targeting?.selected.includes(char.instanceId)}
              onTarget={() => targeting?.toggle(char.instanceId)}
              attachedObjects={attachedObjectsOf(state, char)}
              state={state}
              impact={impactsByCharacter.get(char.instanceId)}
            />
          </div>
        )
      )}
    </div>
  );
}

export function Board({ conn }: { conn: GameConnection }) {
  const state = conn.state!;
  const you = conn.you!;
  const opponentId = otherPlayer(you);
  const { badgesByCharacter, tableEvents, procRolls, spotlights, impactsByCharacter, boardQuake, koFlights } =
    useGameEvents(state);
  // La roue d'initiative ne se joue qu'une fois, à l'ouverture : `phase` quitte 'setup'
  // dès la mise en place terminée, donc une reconnexion en cours de partie ne la rejoue
  // pas. `useCallback` parce que le plateau se redessine à chaque état reçu du serveur et
  // que la roue arme ses minuteurs sur l'identité de ce rappel.
  const [wheelDone, setWheelDone] = useState(false);
  const finishWheel = useCallback(() => setWheelDone(true), []);
  // Un refus que le client a vu venir (jouer une carte hors de son tour, deuxième terrain
  // du tour...) : il n'atteint jamais le serveur, donc il n'apparaît pas dans conn.error.
  const [localError, setLocalError] = useState<string | null>(null);

  const pendingChoice = state.pendingChoice;
  const choiceTargeting = useBoardTargeting(
    state,
    you,
    pendingChoice,
    (choiceId, selected) => conn.answerChoice(choiceId, { kind: 'select-characters', selected }),
    conn.cancelChoice
  );

  const myTurn = state.activePlayerId === you;
  const canAct = myTurn && state.phase === 'main' && !pendingChoice && !state.result;

  // Changement de personnage : le bouton « Switch » n'ouvre plus de liste, il allume le
  // banc et attend un clic sur une carte.
  const [switchMode, setSwitchMode] = useState(false);
  // Le mode ne survit pas à ce qui le rend illégal (fin du tour, choix du moteur qui
  // s'ouvre, partie terminée) : sinon le plateau resterait allumé pour rien.
  useEffect(() => {
    if (!canAct) setSwitchMode(false);
  }, [canAct]);

  // Un choix du moteur passe devant : il est, lui, attendu par le serveur.
  const targeting =
    choiceTargeting ??
    (switchMode
      ? switchTargeting(
          state,
          you,
          (instanceId) => {
            conn.applyAction({ kind: 'switch', newActiveInstanceId: instanceId });
            setSwitchMode(false);
          },
          () => setSwitchMode(false)
        )
      : null);

  // En combat, l'aperçu au survol attend franchement plus longtemps que dans le
  // deck-builder : la souris traverse le plateau en permanence sans chercher à lire quoi
  // que ce soit, et l'aperçu clignoterait sans arrêt.
  const hover = useHoverCard();
  useEffect(() => {
    hover.setPreviewDelay(COMBAT_PREVIEW_DELAY_MS);
    return () => hover.setPreviewDelay(DECK_PREVIEW_DELAY_MS);
  }, [hover]);

  const me = state.players[you];
  const opponent = state.players[opponentId];
  const opponentName = opponent.displayName || 'Adversaire';
  const turnGate = canAct
    ? null
    : state.result
      ? 'la partie est terminée'
      : pendingChoice
        ? 'choix en cours'
        : "ce n'est pas votre tour";

  // Same queries the engine uses, so the counters can never disagree with what the
  // server will actually accept. Wrapped: a query that can't resolve client-side must
  // degrade to the default rather than blank the header.
  const safe = (compute: () => number, fallback: number) => {
    try {
      return compute();
    } catch {
      return fallback;
    }
  };
  const maxObjects = safe(() => getMaxObjectsPerTurn(state, you), DEFAULT_MAX_OBJECTS_PER_TURN);
  const maxTerrains = safe(() => getMaxTerrainsPerTurn(state, you), DEFAULT_MAX_TERRAINS_PER_TURN);

  const activeOf = (player: PlayerState) =>
    player.activeCharacterInstanceId ? player.characters[player.activeCharacterInstanceId] : undefined;
  const aliveOf = (player: PlayerState) =>
    player.benchCharacterInstanceIds.length + (player.activeCharacterInstanceId ? 1 : 0);

  const drawMode = state.mode === 'draw';
  const errorMessage = conn.error ?? localError;
  const showInitiativeWheel = !wheelDone && state.phase === 'setup';

  // Ambiance de fond : le terrain que le joueur a posé teinte tout le plateau. La classe
  // est dérivée de l'id de carte, pas d'une liste tenue à la main -- ajouter une ambiance
  // à un nouveau terrain est alors une règle CSS et rien d'autre, et un terrain sans règle
  // dédiée retombe simplement sur le fond neutre.
  const myTerrainId = me.activeTerrainInstanceId;
  const myTerrainCardId = myTerrainId ? me.terrains[myTerrainId]?.cardId : undefined;
  const ambience = myTerrainCardId ? `board-terrain board-terrain-${myTerrainCardId}` : '';

  return (
    // `targeting` allume les cibles légales et éteint le reste du plateau : c'est la
    // classe qui porte cette mise en avant, côté CSS.
    // `board-quake` est posée puis retirée 300 ms plus tard : c'est ce retrait qui permet
    // au gros coup suivant de rejouer l'animation, une classe restée en place ne
    // redémarrerait rien.
    <div
      className={`board${targeting ? ' targeting' : ''}${ambience ? ` ${ambience}` : ''}${boardQuake ? ` board-quake board-quake-${boardQuake.tier}` : ''}`}
    >
      {/* HUD flottant : trois blocs en grille pour que la capsule de tour soit centrée sur
          la fenêtre et non sur ce qui reste entre ses voisins -- avec `space-between`, elle
          se décalait dès que le Mode Pioche ajoutait son compteur de piles. */}
      <header className={`board-header${myTurn ? ' my-turn' : ''}`}>
        <div className="board-header-side left">
          <span className="board-header-room">
            Salon <strong>{conn.roomCode}</strong>
          </span>
          {drawMode && (
            <span
              className="board-header-piles"
              title="Cartes restantes dans les piles. Celle des terrains est commune aux deux joueurs."
            >
              🂠 {me.drawPiles.characterCardIds.length} · 🎒 {me.drawPiles.objectCardIds.length} · 🗺️{' '}
              {state.sharedTerrainPile.length}
            </span>
          )}
        </div>
        <div className={`board-turn-capsule${myTurn ? ' mine' : ' theirs'}`}>
          <span className="board-turn-number">Tour {state.turnNumber}</span>
          <strong className="board-turn-state">{myTurn ? 'À vous de jouer' : `${opponentName} joue`}</strong>
        </div>
        <div className="board-header-side right">
          <span className="board-header-budget" title="Cartes encore jouables pendant votre tour">
            🎒 {Math.max(0, maxObjects - me.objectsPlayedThisTurn)} · 🗺️{' '}
            {Math.max(0, maxTerrains - me.terrainsPlayedThisTurn)}
          </span>
          <EffectsGlossaryButton />
          {/* Leaving was only possible from the result screen: a player whose opponent
              never comes back had no way out short of reloading. */}
          <ForfeitButton onForfeit={conn.forfeit} />
          <button className="board-leave" onClick={conn.leave} title="Quitter la partie et revenir au lobby">
            Quitter
          </button>
        </div>
      </header>

      {conn.opponentDisconnected && <p className="warning">L'adversaire s'est déconnecté.</p>}
      {errorMessage && (
        <ActionErrorBanner
          message={errorMessage}
          onDismiss={() => {
            setLocalError(null);
            conn.clearError();
          }}
        />
      )}

      <TableEventBanners events={tableEvents} />
      <ProcWheels rolls={procRolls} />
      <CardSpotlights spotlights={spotlights} />
      <KoFlights flights={koFlights} />
      <HeatHazeFilter />

      <div className="arena">
        <OpponentHand player={opponent} />

        <div className="battlefield">
          <div className="battle-line">
          <div className="rail rail-self">
            {drawMode && <CharacterHand player={me} isSelf max={DRAW_MODE_MAX_CHARACTER_HAND} />}
            <GraveyardPile player={me} title="Votre cimetière" orientation="landscape" />
            <BenchRow
              player={me}
              isSelf
              badgesByCharacter={badgesByCharacter}
              state={state}
              you={you}
              conn={conn}
              turnGate={turnGate}
              targeting={targeting}
              impactsByCharacter={impactsByCharacter}
            />
          </div>

          <div className="zone zone-terrain-self">
            <TerrainSlot player={me} side="self" />
          </div>

          <div className="zone zone-active-self">
            <ActiveSlot
              char={activeOf(me)}
              badges={badgesByCharacter.get(me.activeCharacterInstanceId ?? '')}
              side="self"
              targeting={targeting}
              state={state}
              impact={impactsByCharacter.get(me.activeCharacterInstanceId ?? '')}
              hud={{
                label: `${me.displayName || 'Vous'} (vous)`,
                lost: drawMode ? me.charactersLost : null,
                alive: aliveOf(me),
                // Dénominateur pris sur le roster complet, pas sur vivants+cimetière :
                // pendant la mise en place personne n'est encore sur le plateau et le
                // compteur affichait un « 0/0 » qui ne veut rien dire.
                total: Object.keys(me.characters).length,
                isTheirTurn: myTurn,
              }}
              actions={
                <CommandPanel state={state} you={you} conn={conn} onStartSwitch={() => setSwitchMode(true)} />
              }
            />
          </div>

          {/* Ligne de front : elle sépare les deux moitiés du plateau et donne au duel un
              centre lisible, là où les deux actifs se faisaient face sans repère. */}
          <div className="zone zone-vs" aria-hidden="true">
            <span className="vs-line" />
            <span className="vs-badge">VS</span>
            <span className="vs-line" />
          </div>

          <div className="zone zone-active-opp">
            <ActiveSlot
              char={activeOf(opponent)}
              badges={badgesByCharacter.get(opponent.activeCharacterInstanceId ?? '')}
              side="opponent"
              targeting={targeting}
              state={state}
              impact={impactsByCharacter.get(opponent.activeCharacterInstanceId ?? '')}
              hud={{
                label: opponentName,
                lost: drawMode ? opponent.charactersLost : null,
                alive: aliveOf(opponent),
                total: Object.keys(opponent.characters).length,
                isTheirTurn: !myTurn,
              }}
            />
          </div>

          <div className="zone zone-terrain-opp">
            <TerrainSlot player={opponent} side="opponent" />
          </div>

          <div className="rail rail-opp">
            {drawMode && <CharacterHand player={opponent} isSelf={false} max={DRAW_MODE_MAX_CHARACTER_HAND} />}
            <GraveyardPile player={opponent} title="Cimetière adverse" orientation="landscape" />
            <BenchRow
              player={opponent}
              isSelf={false}
              badgesByCharacter={badgesByCharacter}
              state={state}
              you={you}
              conn={conn}
              turnGate={turnGate}
              targeting={targeting}
              impactsByCharacter={impactsByCharacter}
            />
          </div>
          </div>
        </div>
      </div>

      <PlayerHand
        state={state}
        you={you}
        player={me}
        objectDenial={turnGate ?? objectDenial(state, you)}
        terrainDenial={turnGate ?? terrainDenial(state, you)}
        recycleGate={turnGate}
        onPlayObject={(objectInstanceId) => conn.applyAction({ kind: 'play-object', objectInstanceId })}
        onPlayTerrain={(terrainInstanceId) => conn.applyAction({ kind: 'play-terrain', terrainInstanceId })}
        onRecycle={(objectInstanceIds) => conn.applyAction({ kind: 'recycle-objects', objectInstanceIds })}
        onBlocked={setLocalError}
      />

      <EventLog log={state.log} you={you} />

      {showInitiativeWheel && (
        <InitiativeWheel
          starterId={state.startingPlayerId}
          names={{ p1: state.players.p1.displayName, p2: state.players.p2.displayName }}
          onDone={finishWheel}
        />
      )}

      {/* Désigner des personnages se fait sur le plateau (surbrillance + validation) ;
          la modale ne sert plus qu'aux choix que le plateau ne peut pas montrer : options
          textuelles, oui/non, ordre de résolution, et le personnage de départ (pas encore
          posé sur la table à ce moment-là). */}
      {!showInitiativeWheel && targeting && (
        <TargetingBar targeting={targeting} state={state} deadline={conn.choiceDeadline} />
      )}
      {/* Le choix du personnage de départ attend que la roue ait rendu son verdict :
          les deux modales se superposeraient sinon dès la première seconde. */}
      {!showInitiativeWheel && !targeting && pendingChoice && pendingChoice.playerId === you && (
        <ChoiceModal
          state={state}
          choice={pendingChoice}
          deadline={conn.choiceDeadline}
          onAnswer={(answer) => conn.answerChoice(pendingChoice.id, answer)}
          onCancel={pendingChoice.cancellable ? conn.cancelChoice : undefined}
        />
      )}
      {pendingChoice && pendingChoice.playerId !== you && (
        <div className="waiting-badge">
          En attente du choix de l'adversaire...
          {conn.choiceDeadline !== null && <ChoiceCountdownBadge deadline={conn.choiceDeadline} />}
        </div>
      )}

      {state.result && <MatchOverModal state={state} you={you} conn={conn} />}
    </div>
  );
}
