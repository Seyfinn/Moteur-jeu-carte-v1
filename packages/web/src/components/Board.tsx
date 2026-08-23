import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  canAttack,
  canPlayObject,
  canPlayTerrain,
  canSwitchStandard,
  canUseAbility,
  describeDenials,
  getCharacterCard,
  getObjectCard,
  getTerrainCard,
  otherPlayer,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Vote,
} from 'engine';
import { CharacterCard } from './CharacterCard';
import { CardFrame, FaceDownCard } from './CardFrame';
import { ChoiceCountdownBadge, ChoiceModal } from './ChoiceModal';
import { EventLog } from './EventLog';
import { useHoverCard } from './HoverCard';
import { hiddenCardDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import { useGameEvents, type CharacterBadge } from './gameEvents';
import { TableEventBanners } from './gameEventBadges';
import type { GameConnection } from '../net/useGameConnection';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

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
  const coarse = usePointerCoarse();
  const name = objectName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="object"
      name={name}
      size="small"
      onClick={coarse ? () => hover.showCentered({ title: name, body: objectDetailBody(cardId), actionLabel: 'Jouer', onAction: onPlay }) : onPlay}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: objectDetailBody(cardId) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
      footer={<span className="tile-action-label">Jouer</span>}
    />
  );
}

function TerrainHandTile({ cardId, onPlay }: { cardId: string; onPlay: () => void }) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const name = terrainName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="terrain"
      name={name}
      size="small"
      onClick={coarse ? () => hover.showCentered({ title: name, body: terrainDetailBody(cardId), actionLabel: 'Poser', onAction: onPlay }) : onPlay}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: terrainDetailBody(cardId) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
      footer={<span className="tile-action-label">Poser</span>}
    />
  );
}

function RevealedObjectTile({ cardId }: { cardId: string }) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const name = objectName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="object"
      name={name}
      size="small"
      onClick={coarse ? () => hover.showCentered({ title: name, body: objectDetailBody(cardId) }) : undefined}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: objectDetailBody(cardId) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
    />
  );
}

function RevealedTerrainTile({ cardId }: { cardId: string }) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const name = terrainName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="terrain"
      name={name}
      size="small"
      onClick={coarse ? () => hover.showCentered({ title: name, body: terrainDetailBody(cardId) }) : undefined}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: terrainDetailBody(cardId) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
    />
  );
}

function HiddenHandTile({ kind }: { kind: 'object' | 'terrain' }) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const payload = { title: 'Carte cachée', body: hiddenCardDetailBody() };
  return (
    <div
      onMouseEnter={coarse ? undefined : (e) => hover.show(payload, e.currentTarget)}
      onMouseLeave={coarse ? undefined : hover.hide}
      onClick={coarse ? () => hover.showCentered(payload) : undefined}
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
  const coarse = usePointerCoarse();
  const name = terrainName(cardId);
  return (
    <CardFrame
      cardId={cardId}
      kind="terrain"
      name={name}
      size="small"
      onClick={coarse ? () => hover.showCentered({ title: name, body: terrainDetailBody(cardId) }) : undefined}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => hover.show({ title: name, body: terrainDetailBody(cardId) }, e.currentTarget),
              onMouseLeave: hover.hide,
            }
      }
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
  badgesByCharacter,
}: {
  player: PlayerState;
  isSelf: boolean;
  label: string;
  conn: GameConnection;
  badgesByCharacter: Map<string, CharacterBadge[]>;
}) {
  const active = player.activeCharacterInstanceId ? player.characters[player.activeCharacterInstanceId] : undefined;
  const bench = player.benchCharacterInstanceIds.map((id) => player.characters[id]!);
  const graveyard = player.graveyardCharacterInstanceIds.map((id) => player.characters[id]!);

  // Card identity is visible whenever the state we received actually carries the
  // instance data -- true for our own hand, and for the opponent's hand once
  // revealed (e.g. Kirigiri's "Ultimate Détective"); otherwise `getPlayerView`
  // stripped it down to an unresolvable placeholder id.
  const handSlots: HandSlotDef[] = [
    ...player.unplayedObjectInstanceIds.map((id): HandSlotDef => {
      const obj = player.objects[id];
      return obj ? { kind: 'object', id, cardId: obj.cardId } : { kind: 'hidden-object', id };
    }),
    ...player.unplayedTerrainInstanceIds.map((id): HandSlotDef => {
      const terrain = player.terrains[id];
      return terrain ? { kind: 'terrain', id, cardId: terrain.cardId } : { kind: 'hidden-terrain', id };
    }),
  ];

  const benchEmptyCount = Math.max(0, MIN_BENCH_SLOTS - bench.length);
  const handEmptyCount = Math.max(0, MIN_HAND_SLOTS - handSlots.length);

  const benchRow = (
    <div className="slot-row bench-slot-row">
      {bench.map((char) => (
        <div className="card-slot bench-slot" key={char.instanceId}>
          <CharacterCard char={char} isActive={false} isKOable size="small" badges={badgesByCharacter.get(char.instanceId)} />
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
          {slot.kind === 'object' &&
            (isSelf ? (
              <ObjectHandTile cardId={slot.cardId} onPlay={() => conn.applyAction({ kind: 'play-object', objectInstanceId: slot.id })} />
            ) : (
              <RevealedObjectTile cardId={slot.cardId} />
            ))}
          {slot.kind === 'terrain' &&
            (isSelf ? (
              <TerrainHandTile cardId={slot.cardId} onPlay={() => conn.applyAction({ kind: 'play-terrain', terrainInstanceId: slot.id })} />
            ) : (
              <RevealedTerrainTile cardId={slot.cardId} />
            ))}
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

      <div className="active-character-zone">
        {active && <CharacterCard char={active} isActive isKOable badges={badgesByCharacter.get(active.instanceId)} />}
      </div>

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
  /** Non-null when the engine would reject this action right now -- shown instead of firing it. */
  disabledReason?: string | null;
  run: () => void;
}

function ActionMenuButton({
  label,
  options,
  autoFireSingle,
  emptyMessage,
  isOpen,
  onOpen,
  onClose,
}: {
  label: string;
  options: MenuOption[];
  autoFireSingle?: boolean;
  emptyMessage?: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const hover = useHoverCard();
  if (options.length === 0 && !emptyMessage) return null;

  const playable = options.filter((opt) => !opt.disabledReason);
  const allBlocked = options.length > 0 && playable.length === 0;

  const handleClick = () => {
    // Auto-firing only makes sense when there is exactly one *playable* option; with a
    // single blocked one, open the menu so the player can read why it's blocked.
    if (autoFireSingle && playable.length === 1 && options.length === 1) {
      playable[0]!.run();
      return;
    }
    isOpen ? onClose() : onOpen();
  };

  return (
    <div className="menu-item">
      <button
        className={`menu-button${isOpen ? ' menu-button-open' : ''}${allBlocked ? ' menu-button-blocked' : ''}`}
        onClick={handleClick}
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-dropdown">
          {options.length === 0 && <p className="menu-dropdown-empty">{emptyMessage}</p>}
          {options.map((opt) => (
            <button
              key={opt.key}
              className="menu-dropdown-option"
              disabled={Boolean(opt.disabledReason)}
              title={opt.disabledReason ?? undefined}
              onClick={() => {
                opt.run();
                onClose();
              }}
              onMouseEnter={(e) => opt.hover && hover.show(opt.hover, e.currentTarget)}
              onMouseLeave={hover.hide}
            >
              <span>{opt.label}</span>
              {opt.disabledReason ? (
                <span className="menu-dropdown-option-detail blocked">{opt.disabledReason}</span>
              ) : (
                opt.detail && <span className="menu-dropdown-option-detail">{opt.detail}</span>
              )}
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

  /**
   * The same permission queries the server runs, so a blocked action is greyed out with
   * its reason instead of bouncing back as an error. Evaluated against the redacted
   * player view, so it is wrapped: a query that can't resolve something client-side must
   * degrade to "allowed" (the server stays the authority) rather than crash the board.
   */
  const denial = (evaluate: () => { allow: boolean; votes: Vote[] }): string | null => {
    try {
      const result = evaluate();
      return result.allow ? null : describeDenials(result.votes) || 'action impossible';
    } catch {
      return null;
    }
  };

  const attackDenial = activeId ? denial(() => canAttack(state, activeId)) : 'aucun personnage actif';
  const attackOptions: MenuOption[] =
    activeDef && activeId
      ? activeDef.attacks.map((attack) => ({
          key: attack.id,
          label: attack.name,
          detail: `${attack.baseATK} ATK`,
          disabledReason: attackDenial,
          hover: { title: attack.name, subtitle: `${attack.baseATK} ATK`, body: <p>{attack.description}</p> },
          run: () => conn.applyAction({ kind: 'attack', characterInstanceId: activeId, attackId: attack.id }),
        }))
      : [];

  // Abilities flagged `usableFromBench` are legal from the bench, but only the active
  // character's menu used to be built -- so cards like Todo's "Boogie Woogie" or
  // Chopper's "Traque" were simply unreachable while benched.
  const abilityHolders = [
    ...(activeId ? [{ id: activeId, benched: false }] : []),
    ...player.benchCharacterInstanceIds.map((id) => ({ id, benched: true })),
  ];
  const abilityOptions: MenuOption[] = abilityHolders.flatMap(({ id, benched }) => {
    const char = player.characters[id];
    if (!char) return [];
    const def = getCharacterCard(char.cardId);
    return def.abilities
      .filter((ability) => ability.kind === 'active' && !ability.trigger && (!benched || ability.usableFromBench))
      .map((ability) => ({
        key: `${id}:${ability.id}`,
        label: benched ? `${ability.name} — ${def.name}` : ability.name,
        disabledReason: denial(() => canUseAbility(state, id, ability)),
        hover: { title: ability.name, subtitle: `${def.name} · ${ability.kind}`, body: <p>{ability.description}</p> },
        run: () => conn.applyAction({ kind: 'use-ability', characterInstanceId: id, abilityId: ability.id }),
      }));
  });

  const objectDenial = denial(() => canPlayObject(state, you));
  const objectOptions: MenuOption[] = player.unplayedObjectInstanceIds.map((id) => {
    const cardId = player.objects[id]!.cardId;
    const name = objectName(cardId);
    return {
      key: id,
      label: name,
      disabledReason: objectDenial,
      hover: { title: name, body: objectDetailBody(cardId) },
      run: () => conn.applyAction({ kind: 'play-object', objectInstanceId: id }),
    };
  });

  const terrainDenial = denial(() => canPlayTerrain(state, you));
  const terrainOptions: MenuOption[] = player.unplayedTerrainInstanceIds.map((id) => {
    const cardId = player.terrains[id]!.cardId;
    const name = terrainName(cardId);
    return {
      key: id,
      label: name,
      disabledReason: terrainDenial,
      hover: { title: name, body: terrainDetailBody(cardId) },
      run: () => conn.applyAction({ kind: 'play-terrain', terrainInstanceId: id }),
    };
  });

  const switchDenial = activeId ? denial(() => canSwitchStandard(state, activeId)) : 'aucun personnage actif';
  const switchOptions: MenuOption[] = player.benchCharacterInstanceIds.map((id) => {
    const name = getCharacterCard(player.characters[id]!.cardId).name;
    return {
      key: id,
      label: name,
      disabledReason: switchDenial,
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
        emptyMessage="Pas de capacité activable"
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
  const { badgesByCharacter, tableEvents } = useGameEvents(state);

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
        <button className="primary" onClick={conn.leave}>
          Retour au lobby
        </button>
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

      <TableEventBanners events={tableEvents} />

      <div className="board-scroll">
        <div className="board-grid">
          <PlayerZone player={state.players[opponentId]} isSelf={false} label="Adversaire" conn={conn} badgesByCharacter={badgesByCharacter} />
          <PlayerZone player={state.players[you]} isSelf label="Vous" conn={conn} badgesByCharacter={badgesByCharacter} />
        </div>

        <EventLog log={state.log} />
      </div>

      <ActionMenu state={state} you={you} conn={conn} />

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
