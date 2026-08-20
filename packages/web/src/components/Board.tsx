import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCharacterCard, getObjectCard, getTerrainCard, otherPlayer, type GameState, type PlayerId, type PlayerState } from 'engine';
import { CharacterCard } from './CharacterCard';
import { CardFrame, FaceDownCard } from './CardFrame';
import { ChoiceModal } from './ChoiceModal';
import { EventLog } from './EventLog';
import { useHoverCard } from './HoverCard';
import { hiddenCardDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import type { GameConnection } from '../net/useGameConnection';

function objectName(cardId: string): string {
  try {
    return getObjectCard(cardId).name;
  } catch {
    return cardId;
  }
}
function terrainName(cardId: string): string {
  try {
    return getTerrainCard(cardId).name;
  } catch {
    return cardId;
  }
}

function ObjectHandTile({ cardId, onPlay }: { cardId: string; onPlay: () => void }) {
  const hover = useHoverCard();
  const name = objectName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="object"
      name={name}
      size="small"
      onClick={onPlay}
      hoverProps={{
        onMouseEnter: (e) => hover.show({ title: name, body: objectDetailBody(cardId) }, e.currentTarget),
        onMouseLeave: hover.hide,
      }}
      footer={<span className="tile-action-label">Jouer</span>}
    />
  );
}

function TerrainHandTile({ cardId, onPlay }: { cardId: string; onPlay: () => void }) {
  const hover = useHoverCard();
  const name = terrainName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="terrain"
      name={name}
      size="small"
      onClick={onPlay}
      hoverProps={{
        onMouseEnter: (e) => hover.show({ title: name, body: terrainDetailBody(cardId) }, e.currentTarget),
        onMouseLeave: hover.hide,
      }}
      footer={<span className="tile-action-label">Poser</span>}
    />
  );
}

function HiddenHandTile({ kind }: { kind: 'object' | 'terrain' }) {
  const hover = useHoverCard();
  return (
    <div
      onMouseEnter={(e) => hover.show({ title: 'Carte cachée', body: hiddenCardDetailBody() }, e.currentTarget)}
      onMouseLeave={hover.hide}
    >
      <FaceDownCard />
    </div>
  );
}

function ActionErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <p className="error action-error">
      {message}
      <button className="action-error-dismiss" onClick={onDismiss} aria-label="Fermer">
        ×
      </button>
    </p>
  );
}

function ActiveTerrainBadge({ cardId }: { cardId: string }) {
  const hover = useHoverCard();
  const name = terrainName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="terrain"
      name={name}
      size="small"
      hoverProps={{
        onMouseEnter: (e) => hover.show({ title: name, body: terrainDetailBody(cardId) }, e.currentTarget),
        onMouseLeave: hover.hide,
      }}
    />
  );
}

const MIN_BENCH_SLOTS = 6;
const MIN_HAND_SLOTS = 6;

type HandSlotDef =
  | { kind: 'object'; id: string; cardId: string }
  | { kind: 'terrain'; id: string; cardId: string }
  | { kind: 'hidden-object'; id: string }
  | { kind: 'hidden-terrain'; id: string };

function PlayerZone({
  player,
  isSelf,
  label,
  conn,
}: {
  player: PlayerState;
  isSelf: boolean;
  label: string;
  conn: GameConnection;
}) {
  const active = player.activeCharacterInstanceId ? player.characters[player.activeCharacterInstanceId] : undefined;
  const bench = player.benchCharacterInstanceIds.map((id) => player.characters[id]!);
  const graveyard = player.graveyardCharacterInstanceIds.map((id) => player.characters[id]!);

  const handSlots: HandSlotDef[] = isSelf
    ? [
        ...player.unplayedObjectInstanceIds.map((id) => ({ kind: 'object' as const, id, cardId: player.objects[id]!.cardId })),
        ...player.unplayedTerrainInstanceIds.map((id) => ({ kind: 'terrain' as const, id, cardId: player.terrains[id]!.cardId })),
      ]
    : [
        ...player.unplayedObjectInstanceIds.map((id) => ({ kind: 'hidden-object' as const, id })),
        ...player.unplayedTerrainInstanceIds.map((id) => ({ kind: 'hidden-terrain' as const, id })),
      ];

  const benchEmptyCount = Math.max(0, MIN_BENCH_SLOTS - bench.length);
  const handEmptyCount = Math.max(0, MIN_HAND_SLOTS - handSlots.length);

  const benchRow = (
    <div className="slot-row bench-slot-row">
      {bench.map((char) => (
        <div className="card-slot bench-slot" key={char.instanceId}>
          <CharacterCard char={char} isActive={false} isKOable size="small" />
        </div>
      ))}
      {Array.from({ length: benchEmptyCount }).map((_, i) => (
        <div className="card-slot bench-slot empty" key={`bench-empty-${i}`} />
      ))}
    </div>
  );

  const handRow = (
    <div className="slot-row hand-slot-row">
      {handSlots.map((slot) => (
        <div className="card-slot hand-slot" key={slot.id}>
          {slot.kind === 'object' && (
            <ObjectHandTile cardId={slot.cardId} onPlay={() => conn.applyAction({ kind: 'play-object', objectInstanceId: slot.id })} />
          )}
          {slot.kind === 'terrain' && (
            <TerrainHandTile cardId={slot.cardId} onPlay={() => conn.applyAction({ kind: 'play-terrain', terrainInstanceId: slot.id })} />
          )}
          {slot.kind === 'hidden-object' && <HiddenHandTile kind="object" />}
          {slot.kind === 'hidden-terrain' && <HiddenHandTile kind="terrain" />}
        </div>
      ))}
      {Array.from({ length: handEmptyCount }).map((_, i) => (
        <div className="card-slot hand-slot empty" key={`hand-empty-${i}`} />
      ))}
    </div>
  );

  const centerRow = (
    <div className="center-row">
      <div className="graveyard-zone">
        <span className="zone-label">Cimetière</span>
        <div className="graveyard-cards">
          {graveyard.length === 0 && <span className="zone-count-empty">—</span>}
          {graveyard.map((char) => (
            <div className="graveyard-thumb" key={char.instanceId}>
              <CharacterCard char={char} isActive={false} isKOable size="small" />
            </div>
          ))}
        </div>
      </div>

      <div className="active-character-zone">{active && <CharacterCard char={active} isActive isKOable />}</div>

      <div className="terrain-zone">
        <span className="zone-label">Magie active</span>
        {player.activeTerrainInstanceId ? (
          <ActiveTerrainBadge cardId={player.terrains[player.activeTerrainInstanceId]!.cardId} />
        ) : (
          <span className="terrain-badge empty">Aucun</span>
        )}
      </div>
    </div>
  );

  return (
    <div className={`player-zone player-mat${isSelf ? ' self' : ' opponent'}`}>
      <h2>{label}</h2>
      {isSelf ? (
        <>
          {centerRow}
          {benchRow}
          {handRow}
        </>
      ) : (
        <>
          {handRow}
          {benchRow}
          {centerRow}
        </>
      )}
    </div>
  );
}

interface MenuOption {
  key: string;
  label: string;
  detail?: string;
  hover?: { title: string; subtitle?: string; body: ReactNode };
  run: () => void;
}

function ActionMenuButton({
  label,
  options,
  autoFireSingle,
  isOpen,
  onOpen,
  onClose,
}: {
  label: string;
  options: MenuOption[];
  autoFireSingle?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const hover = useHoverCard();
  if (options.length === 0) return null;

  const handleClick = () => {
    if (autoFireSingle && options.length === 1) {
      options[0]!.run();
      return;
    }
    isOpen ? onClose() : onOpen();
  };

  return (
    <div className="menu-item">
      <button className={`menu-button${isOpen ? ' menu-button-open' : ''}`} onClick={handleClick}>
        {label}
      </button>
      {isOpen && (
        <div className="menu-dropdown">
          {options.map((opt) => (
            <button
              key={opt.key}
              className="menu-dropdown-option"
              onClick={() => {
                opt.run();
                onClose();
              }}
              onMouseEnter={(e) => opt.hover && hover.show(opt.hover, e.currentTarget)}
              onMouseLeave={hover.hide}
            >
              <span>{opt.label}</span>
              {opt.detail && <span className="menu-dropdown-option-detail">{opt.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionMenu({ state, you, conn }: { state: GameState; you: PlayerId; conn: GameConnection }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [openMenu]);

  const player = state.players[you];
  const isMyTurn = state.activePlayerId === you && state.phase === 'main' && !state.pendingChoice;
  if (!isMyTurn) return null;

  const activeId = player.activeCharacterInstanceId;
  const activeChar = activeId ? player.characters[activeId] : undefined;
  const activeDef = activeChar ? getCharacterCard(activeChar.cardId) : undefined;

  const attackOptions: MenuOption[] =
    activeDef && activeId
      ? activeDef.attacks.map((attack) => ({
          key: attack.id,
          label: attack.name,
          detail: `${attack.baseATK} ATK`,
          hover: { title: attack.name, subtitle: `${attack.baseATK} ATK`, body: <p>{attack.description}</p> },
          run: () => conn.applyAction({ kind: 'attack', characterInstanceId: activeId, attackId: attack.id }),
        }))
      : [];

  const abilityOptions: MenuOption[] =
    activeDef && activeId
      ? activeDef.abilities
          .filter((a) => !a.trigger)
          .map((ability) => ({
            key: ability.id,
            label: ability.name,
            hover: { title: ability.name, subtitle: ability.kind, body: <p>{ability.description}</p> },
            run: () => conn.applyAction({ kind: 'use-ability', characterInstanceId: activeId, abilityId: ability.id }),
          }))
      : [];

  const objectOptions: MenuOption[] = player.unplayedObjectInstanceIds.map((id) => {
    const cardId = player.objects[id]!.cardId;
    const name = objectName(cardId);
    return {
      key: id,
      label: name,
      hover: { title: name, body: objectDetailBody(cardId) },
      run: () => conn.applyAction({ kind: 'play-object', objectInstanceId: id }),
    };
  });

  const terrainOptions: MenuOption[] = player.unplayedTerrainInstanceIds.map((id) => {
    const cardId = player.terrains[id]!.cardId;
    const name = terrainName(cardId);
    return {
      key: id,
      label: name,
      hover: { title: name, body: terrainDetailBody(cardId) },
      run: () => conn.applyAction({ kind: 'play-terrain', terrainInstanceId: id }),
    };
  });

  const switchOptions: MenuOption[] = player.benchCharacterInstanceIds.map((id) => {
    const name = getCharacterCard(player.characters[id]!.cardId).name;
    return {
      key: id,
      label: name,
      run: () => conn.applyAction({ kind: 'switch', newActiveInstanceId: id }),
    };
  });

  return (
    <div className="menu-bar" ref={barRef}>
      <ActionMenuButton
        label="Attaque"
        options={attackOptions}
        autoFireSingle
        isOpen={openMenu === 'attack'}
        onOpen={() => setOpenMenu('attack')}
        onClose={() => setOpenMenu(null)}
      />
      <ActionMenuButton
        label="Capacité"
        options={abilityOptions}
        autoFireSingle
        isOpen={openMenu === 'ability'}
        onOpen={() => setOpenMenu('ability')}
        onClose={() => setOpenMenu(null)}
      />
      <ActionMenuButton
        label="Objet"
        options={objectOptions}
        isOpen={openMenu === 'object'}
        onOpen={() => setOpenMenu('object')}
        onClose={() => setOpenMenu(null)}
      />
      <ActionMenuButton
        label="Terrain"
        options={terrainOptions}
        isOpen={openMenu === 'terrain'}
        onOpen={() => setOpenMenu('terrain')}
        onClose={() => setOpenMenu(null)}
      />
      <ActionMenuButton
        label="Switch"
        options={switchOptions}
        isOpen={openMenu === 'switch'}
        onOpen={() => setOpenMenu('switch')}
        onClose={() => setOpenMenu(null)}
      />
      <div className="menu-item menu-item-pass">
        <button className="menu-button pass-button" onClick={() => conn.applyAction({ kind: 'pass' })}>
          Passer
        </button>
      </div>
    </div>
  );
}

export function Board({ conn }: { conn: GameConnection }) {
  const state = conn.state!;
  const you = conn.you!;
  const opponentId = otherPlayer(you);

  if (state.result) {
    const message =
      state.result.kind === 'draw'
        ? 'Égalité parfaite !'
        : state.result.winner === you
          ? 'Vous avez gagné !'
          : 'Vous avez perdu.';
    return (
      <div className="board">
        <h1 className="result-banner">{message}</h1>
        <EventLog log={state.log} />
      </div>
    );
  }

  const pendingChoice = state.pendingChoice;

  return (
    <div className="board">
      <header className="board-header">
        <span>
          Salon <strong>{conn.roomCode}</strong>
        </span>
        <span>Tour {state.turnNumber}</span>
        <span>{state.activePlayerId === you ? 'À vous de jouer' : "Tour de l'adversaire"}</span>
      </header>

      {conn.opponentDisconnected && <p className="warning">L'adversaire s'est déconnecté.</p>}
      {conn.error && <ActionErrorBanner message={conn.error} onDismiss={conn.clearError} />}

      <div className="board-scroll">
        <div className="board-grid">
          <PlayerZone player={state.players[opponentId]} isSelf={false} label="Adversaire" conn={conn} />
          <PlayerZone player={state.players[you]} isSelf label="Vous" conn={conn} />
        </div>

        <EventLog log={state.log} />
      </div>

      <ActionMenu state={state} you={you} conn={conn} />

      {pendingChoice && pendingChoice.playerId === you && (
        <ChoiceModal state={state} choice={pendingChoice} onAnswer={(answer) => conn.answerChoice(pendingChoice.id, answer)} />
      )}
      {pendingChoice && pendingChoice.playerId !== you && (
        <div className="waiting-badge">En attente du choix de l'adversaire...</div>
      )}
    </div>
  );
}
