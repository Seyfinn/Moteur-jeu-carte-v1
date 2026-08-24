import { useEffect, useRef, useState } from 'react';
import {
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
import { CharacterCard } from './CharacterCard';
import { CardFrame } from './CardFrame';
import { ChoiceCountdownBadge, ChoiceModal } from './ChoiceModal';
import { CommandPanel } from './CommandPanel';
import { EffectsGlossaryButton } from './EffectsGlossary';
import { EventLog } from './EventLog';
import { GraveyardPile } from './GraveyardPile';
import { OpponentHand, PlayerHand } from './HandFan';
import { useCardInspect, useHoverCard } from './HoverCard';
import { characterDetailBody, terrainDetailBody } from './cardDetails';
import {
  abilityOptionsFor,
  characterName,
  objectDenial,
  switchOptions,
  terrainDenial,
  terrainName,
  type ActionOption,
} from './boardActions';
import { useGameEvents, type CharacterBadge } from './gameEvents';
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

function TerrainSlot({ player }: { player: PlayerState }) {
  const terrainId = player.activeTerrainInstanceId;
  const terrain = terrainId ? player.terrains[terrainId] : undefined;
  const name = terrain ? terrainName(terrain.cardId) : 'Aucun terrain';
  const inspect = useCardInspect({
    title: name,
    card: { cardId: terrain?.cardId ?? '', kind: 'terrain', name },
    body: terrain ? terrainDetailBody(terrain.cardId) : null,
  });

  return (
    <div className="terrain-slot-zone">
      <span className="zone-label">Magie active</span>
      {terrain ? (
        <CardFrame
          cardId={terrain.cardId}
          kind="terrain"
          name={name}
          size="small"
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
        <span className="terrain-badge empty">Aucun</span>
      )}
    </div>
  );
}

function Nameplate({
  label,
  alive,
  total,
  isSelf,
  isTheirTurn,
}: {
  label: string;
  alive: number;
  total: number;
  isSelf: boolean;
  isTheirTurn: boolean;
}) {
  return (
    <div className={`nameplate${isSelf ? ' self' : ' opponent'}${isTheirTurn ? ' active-turn' : ''}`}>
      <span className="nameplate-name">{label}</span>
      <span className="nameplate-meta">
        <span title="Personnages encore en jeu">
          {alive}/{total} perso
        </span>
        {isTheirTurn && <span className="nameplate-turn-pill">joue</span>}
      </span>
    </div>
  );
}

function ActiveSlot({
  char,
  badges,
  side,
}: {
  char: CharacterInstance | undefined;
  badges?: CharacterBadge[];
  side: 'self' | 'opponent';
}) {
  if (!char) {
    return <div className={`active-slot empty ${side}`}>Aucun personnage actif</div>;
  }
  return (
    <div className={`active-slot ${side}`}>
      {/* La clé est indispensable ici : le slot garde sa place dans l'arbre quand l'actif
          change, donc sans elle React réutilise le même CharacterCard et son compteur de
          dégâts compare les PV de deux personnages différents -- le nouvel arrivant
          récoltait un « -N » et un flash de dégâts qu'il n'a jamais subis. */}
      <CharacterCard
        key={char.instanceId}
        char={char}
        isActive
        isKOable
        size="large"
        orientation="landscape"
        badges={badges}
      />
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
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const name = characterName(char.cardId);
  const inspect = useCardInspect({
    id: char.instanceId,
    title: name,
    card: { cardId: char.cardId, kind: 'character', name },
    body: characterDetailBody(char.cardId, char),
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
        badges={badges}
        selected={isOpen}
        onSelect={onToggle}
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
}: {
  player: PlayerState;
  isSelf: boolean;
  badgesByCharacter: Map<string, CharacterBadge[]>;
  state: GameState;
  you: PlayerId;
  conn: GameConnection;
  turnGate: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const bench = player.benchCharacterInstanceIds
    .map((id) => player.characters[id])
    .filter((char): char is CharacterInstance => char !== undefined);

  // Un mini-menu ouvert sur un personnage qui vient de partir au combat (ou de mourir)
  // n'a plus de carte sous lui : le refermer plutôt que le laisser flotter.
  useEffect(() => {
    if (openId && !player.benchCharacterInstanceIds.includes(openId)) setOpenId(null);
  }, [openId, player.benchCharacterInstanceIds]);

  return (
    <div className={`bench-row${isSelf ? ' self' : ' opponent'}`}>
      {bench.length === 0 && <span className="bench-row-empty">Banc vide</span>}
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
          />
        ) : (
          <div className="bench-card-wrap" key={char.instanceId}>
            <CharacterCard
              char={char}
              isActive={false}
              isKOable
              size="small"
              badges={badgesByCharacter.get(char.instanceId)}
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
  const { badgesByCharacter, tableEvents } = useGameEvents(state);
  // Un refus que le client a vu venir (jouer une carte hors de son tour, deuxième terrain
  // du tour...) : il n'atteint jamais le serveur, donc il n'apparaît pas dans conn.error.
  const [localError, setLocalError] = useState<string | null>(null);

  if (state.result) {
    // Une victoire par abandon se lit autrement qu'une victoire au plateau : sans le
    // dire, le gagnant voit « Vous avez gagné » sans comprendre pourquoi la partie
    // s'est arrêtée net.
    const forfeited = state.result.kind === 'win' && state.result.reason === 'forfeit';
    const message =
      state.result.kind === 'draw'
        ? 'Égalité parfaite !'
        : state.result.winner === you
          ? forfeited
            ? `${state.players[opponentId].displayName || 'Adversaire'} a abandonné — vous gagnez !`
            : 'Vous avez gagné !'
          : forfeited
            ? 'Vous avez abandonné la partie.'
            : 'Vous avez perdu.';
    return (
      <div className="board">
        <h1 className="result-banner">{message}</h1>
        <button className="primary" onClick={conn.leave}>
          Retour au lobby
        </button>
        <EventLog log={state.log} you={you} />
      </div>
    );
  }

  const pendingChoice = state.pendingChoice;
  const me = state.players[you];
  const opponent = state.players[opponentId];
  const myTurn = state.activePlayerId === you;
  const opponentName = opponent.displayName || 'Adversaire';
  const canAct = myTurn && state.phase === 'main' && !pendingChoice;
  const turnGate = canAct ? null : pendingChoice ? 'choix en cours' : "ce n'est pas votre tour";

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

  const errorMessage = conn.error ?? localError;

  return (
    <div className="board">
      <header className={`board-header${myTurn ? ' my-turn' : ''}`}>
        <span className="board-header-room">
          Salon <strong>{conn.roomCode}</strong>
        </span>
        <span className="board-header-turn">
          Tour {state.turnNumber} · <strong>{myTurn ? 'à vous de jouer' : `${opponentName} joue`}</strong>
        </span>
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

      <div className="arena">
        <OpponentHand player={opponent} />

        <div className="battlefield">
          <div className="rail rail-self">
            <GraveyardPile player={me} title="Votre cimetière" />
            <TerrainSlot player={me} />
          </div>

          <div className="zone zone-plate-self">
            <Nameplate
              label={`${me.displayName || 'Vous'} (vous)`}
              alive={aliveOf(me)}
              // Dénominateur pris sur le roster complet, pas sur vivants+cimetière : pendant
              // la mise en place personne n'est encore sur le plateau et le compteur
              // affichait un « 0/0 » qui ne veut rien dire.
              total={Object.keys(me.characters).length}
              isSelf
              isTheirTurn={myTurn}
            />
          </div>

          <div className="zone zone-active-self">
            <ActiveSlot
              char={activeOf(me)}
              badges={badgesByCharacter.get(me.activeCharacterInstanceId ?? '')}
              side="self"
            />
          </div>

          <div className="zone zone-lower-self">
            <CommandPanel state={state} you={you} conn={conn} />
            <BenchRow
              player={me}
              isSelf
              badgesByCharacter={badgesByCharacter}
              state={state}
              you={you}
              conn={conn}
              turnGate={turnGate}
            />
          </div>

          <div className="zone zone-bench-opp">
            <BenchRow
              player={opponent}
              isSelf={false}
              badgesByCharacter={badgesByCharacter}
              state={state}
              you={you}
              conn={conn}
              turnGate={turnGate}
            />
          </div>

          <div className="zone zone-active-opp">
            <ActiveSlot
              char={activeOf(opponent)}
              badges={badgesByCharacter.get(opponent.activeCharacterInstanceId ?? '')}
              side="opponent"
            />
          </div>

          <div className="zone zone-plate-opp">
            <Nameplate
              label={opponentName}
              alive={aliveOf(opponent)}
              total={Object.keys(opponent.characters).length}
              isSelf={false}
              isTheirTurn={!myTurn}
            />
          </div>

          <div className="rail rail-opp">
            <GraveyardPile player={opponent} title="Cimetière adverse" />
            <TerrainSlot player={opponent} />
          </div>
        </div>
      </div>

      <PlayerHand
        player={me}
        objectDenial={turnGate ?? objectDenial(state, you)}
        terrainDenial={turnGate ?? terrainDenial(state, you)}
        onPlayObject={(objectInstanceId) => conn.applyAction({ kind: 'play-object', objectInstanceId })}
        onPlayTerrain={(terrainInstanceId) => conn.applyAction({ kind: 'play-terrain', terrainInstanceId })}
        onBlocked={setLocalError}
      />

      <EventLog log={state.log} you={you} />

      {pendingChoice && pendingChoice.playerId === you && (
        <ChoiceModal
          state={state}
          choice={pendingChoice}
          deadline={conn.choiceDeadline}
          onAnswer={(answer) => conn.answerChoice(pendingChoice.id, answer)}
        />
      )}
      {pendingChoice && pendingChoice.playerId !== you && (
        <div className="waiting-badge">
          En attente du choix de l'adversaire...
          {conn.choiceDeadline !== null && <ChoiceCountdownBadge deadline={conn.choiceDeadline} />}
        </div>
      )}
    </div>
  );
}
