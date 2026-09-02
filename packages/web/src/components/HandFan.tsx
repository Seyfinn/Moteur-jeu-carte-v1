import { useEffect, useState, type CSSProperties } from 'react';
import { RECYCLE_OBJECT_COST, type GameState, type PlayerId, type PlayerState } from 'engine';
import { CardFrame, FaceDownCard } from './CardFrame';
import { useCardInspect, useHoverCard, type HoverPayload } from './HoverCard';
import { characterDetailBody, hiddenCardDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import { characterName, objectCardDenial, objectName, recycleDenial, terrainName } from './boardActions';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

export type HandSlot =
  | { kind: 'object'; id: string; cardId: string }
  | { kind: 'terrain'; id: string; cardId: string }
  | { kind: 'hidden'; id: string };

/**
 * L'identité d'une carte n'est lisible que si l'état reçu porte réellement son instance :
 * toujours vrai pour notre propre main, et pour celle de l'adversaire une fois révélée
 * (« Ultimate Détective » de Kirigiri). Sinon `getPlayerView` l'a réduite à un id
 * placeholder impossible à résoudre -- c'est le dos de carte.
 */
export function handSlots(player: PlayerState): HandSlot[] {
  return [
    ...player.unplayedObjectInstanceIds.map((id): HandSlot => {
      const obj = player.objects[id];
      return obj ? { kind: 'object', id, cardId: obj.cardId } : { kind: 'hidden', id };
    }),
    ...player.unplayedTerrainInstanceIds.map((id): HandSlot => {
      const terrain = player.terrains[id];
      return terrain ? { kind: 'terrain', id, cardId: terrain.cardId } : { kind: 'hidden', id };
    }),
  ];
}

/**
 * Éventail « façon Slay the Spire ». Rotation, retombée et ordre d'empilement partent tous
 * les trois en variables CSS, jamais en `transform` / `zIndex` posés en ligne : un style en
 * ligne gagne sur toute règle de feuille de style, et la carte survolée ne pourrait plus se
 * redresser, grandir, ni passer devant ses voisines.
 *
 * L'arc est calculé sur la main ENTIÈRE (objets puis terrains), pas par groupe : les deux
 * paquets sont séparés à l'écran mais dessinent une seule courbe continue, sinon la main
 * ressemblait à deux petits éventails posés l'un à côté de l'autre.
 */
function fanStyle(index: number, count: number): CSSProperties {
  const edge = (count - 1) / 2;
  const offset = index - edge;
  // Arc total visé ~38°, plafonné à 5° par carte pour qu'une main de trois cartes ne
  // reste pas à plat maintenant que l'éventail a toute la largeur pour s'ouvrir.
  const step = count > 1 ? Math.min(5, 38 / count) : 0;
  // Retombée toujours NÉGATIVE : c'est le centre qui monte, les extrémités restant sur la
  // ligne de base. Avec une parabole positive, ce sont les bords qui descendaient -- et
  // sur une main de onze cartes ils passaient sous le bas de la fenêtre, qui se mettait
  // alors à défiler.
  const lift = (offset * offset - edge * edge) * (count > 8 ? 1.15 : 1.9);
  return {
    '--fan-rot': `${(offset * step).toFixed(2)}deg`,
    '--fan-lift': `${lift.toFixed(1)}px`,
    '--fan-z': index + 1,
  } as CSSProperties;
}

/**
 * Chevauchement des cartes, décidé sur le nombre de cartes en main. L'éventail dispose
 * maintenant de 85 % de la largeur de l'écran : une petite main s'y étale presque sans se
 * recouvrir, et seules les grosses mains ont encore besoin de se serrer pour ne pas
 * déborder du cadre.
 */
function fanSpread(count: number): CSSProperties {
  // Fraction de la largeur d'une carte ajoutée (positif) ou reprise (négatif) entre deux
  // voisines. Une main ordinaire tient très largement dans les 85 % : elle s'aère au lieu
  // de se recouvrir, et seules les mains vraiment chargées se remettent à se serrer.
  const overlap = count > 16 ? -0.22 : count > 12 ? -0.14 : count > 9 ? -0.06 : count > 6 ? 0.02 : 0.06;
  return { '--fan-overlap': overlap } as CSSProperties;
}

/**
 * Une carte de la main. Deux régimes : en temps normal, un clic la joue ; pendant une
 * sélection du Recycleur (`recycle`), le même clic ne fait plus que cocher/décocher la
 * carte -- une carte qu'on s'apprête à sacrifier ne doit surtout pas pouvoir partir en jeu
 * par le même geste.
 */
function PlayerHandCard({
  slot,
  index,
  count,
  disabledReason,
  recycle,
  onPlay,
  onBlocked,
}: {
  slot: Extract<HandSlot, { kind: 'object' | 'terrain' }>;
  index: number;
  count: number;
  disabledReason: string | null;
  recycle: { selected: boolean; onToggle: () => void } | null;
  onPlay: () => void;
  onBlocked: (reason: string) => void;
}) {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  const isObject = slot.kind === 'object';
  const name = isObject ? objectName(slot.cardId) : terrainName(slot.cardId);
  const verb = recycle ? (recycle.selected ? 'Retirer' : 'Recycler') : isObject ? 'Jouer' : 'Poser';

  const payload: HoverPayload = {
    title: name,
    subtitle: disabledReason ?? undefined,
    card: { cardId: slot.cardId, kind: slot.kind, name },
    body: isObject ? objectDetailBody(slot.cardId) : terrainDetailBody(slot.cardId),
    actionLabel: disabledReason ? undefined : verb,
    onAction: recycle ? recycle.onToggle : onPlay,
  };

  // Au doigt il n'y a pas de survol pour lire la carte avant de la jouer : le tap ouvre
  // la fiche en grand, qui porte elle-même le bouton « Jouer ». À la souris, le survol
  // affiche déjà la fiche, donc le clic joue directement.
  // Le Recycleur est l'exception aux deux : cocher une carte doit rester un geste immédiat,
  // à la souris comme au doigt, sinon composer une sélection de trois cartes demanderait
  // trois allers-retours dans une fiche plein écran.
  const handleClick = () => {
    if (recycle) {
      recycle.onToggle();
      return;
    }
    if (coarse) {
      hover.showCentered(payload);
      return;
    }
    if (disabledReason) {
      onBlocked(disabledReason);
      return;
    }
    onPlay();
  };

  return (
    <div
      className={`hand-card hand-card-${slot.kind}${disabledReason ? ' blocked' : ''}${recycle?.selected ? ' recycle-selected' : ''}`}
      style={fanStyle(index, count)}
    >
      {/* Le mouvement vit sur cette boîte INTÉRIEURE, jamais sur `.hand-card` : c'est
          `.hand-card` qui reçoit le survol, et une boîte qui bondit de 120 px se dérobait
          sous le curseur -- le survol se perdait, la carte retombait, le survol revenait,
          et la carte tremblait en boucle. La zone sensible, elle, ne bouge plus. */}
      <div className="hand-card-lift">
        {/* Un terrain se joue autrement qu'un objet (un seul par tour, il remplace celui en
            place) : il s'annonce donc sur la carte, et pas seulement par la couleur du halo. */}
        {slot.kind === 'terrain' && (
          <span className="hand-type-badge" aria-hidden="true">
            🗺️ Terrain
          </span>
        )}
        <CardFrame
          cardId={slot.cardId}
          kind={slot.kind}
          name={name}
          size="normal"
          // Objets comme terrains restent en portrait : c'est le cadrage pour lequel les
          // illustrations sont faites, et le paysage est réservé aux personnages en jeu.
          orientation="portrait"
          // Au doigt, la carte reste en pleine couleur même injouable : le tap sert d'abord à
          // la lire, et le libellé « Indisponible » dit déjà qu'elle ne partira pas.
          dimmed={Boolean(disabledReason) && !coarse}
          onClick={disabledReason && recycle ? undefined : handleClick}
          title={disabledReason ?? undefined}
          hoverProps={
            coarse
              ? undefined
              : {
                  onMouseEnter: (e) => hover.show(payload, e.currentTarget),
                  onMouseLeave: hover.hide,
                }
          }
          footer={<span className={`hand-card-hint${disabledReason ? ' blocked' : ''}`}>{disabledReason ? 'Indisponible' : verb}</span>}
        />
      </div>
    </div>
  );
}

/**
 * Le Recycleur d'Objets, à gauche de l'éventail : 3 objets de la main contre 1 objet tiré
 * au hasard dans la réserve. Utilisable autant de fois qu'on veut dans son tour, sans
 * toucher au budget d'objets jouables -- d'où une zone à part, et non une entrée du panneau
 * de commandes où tout le reste coûte l'action ou le tour.
 */
function RecyclerZone({
  denial,
  selectedCount,
  open,
  onOpen,
  onCancel,
  onSubmit,
  onBlocked,
}: {
  denial: string | null;
  selectedCount: number;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onBlocked: (reason: string) => void;
}) {
  const ready = selectedCount === RECYCLE_OBJECT_COST;

  return (
    <div className={`recycler-zone${open ? ' open' : ''}${denial ? ' blocked' : ''}`}>
      <span className="recycler-title">♻️ Recycleur</span>
      {open ? (
        <>
          <span className="recycler-count">
            <strong>{selectedCount}</strong>/{RECYCLE_OBJECT_COST}
          </span>
          <span className="recycler-hint">
            {ready ? 'Prêt à échanger' : `Choisissez ${RECYCLE_OBJECT_COST - selectedCount} objet(s) dans votre main`}
          </span>
          <div className="recycler-actions">
            <button className="recycler-confirm" disabled={!ready} onClick={onSubmit}>
              Échanger
            </button>
            <button className="recycler-cancel" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="recycler-hint">{denial ?? `${RECYCLE_OBJECT_COST} objets → 1 objet au hasard`}</span>
          <button
            className="recycler-open"
            title={denial ?? 'Sacrifier 3 objets de votre main pour en tirer un au hasard'}
            onClick={() => (denial ? onBlocked(denial) : onOpen())}
          >
            Recycler
          </button>
        </>
      )}
    </div>
  );
}

/** La main du joueur, en éventail tout en bas de l'écran, avec le Recycleur à sa gauche. */
export function PlayerHand({
  state,
  you,
  player,
  objectDenial,
  terrainDenial,
  recycleGate,
  onPlayObject,
  onPlayTerrain,
  onRecycle,
  onBlocked,
}: {
  state: GameState;
  you: PlayerId;
  player: PlayerState;
  objectDenial: string | null;
  terrainDenial: string | null;
  /** Refus qui prime sur celui du moteur (tour adverse, choix en attente, partie finie). */
  recycleGate: string | null;
  onPlayObject: (instanceId: string) => void;
  onPlayTerrain: (instanceId: string) => void;
  onRecycle: (objectInstanceIds: string[]) => void;
  onBlocked: (reason: string) => void;
}) {
  const slots = handSlots(player);
  const [recycling, setRecycling] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const recycleUnavailable = recycleGate ?? recycleDenial(state, you);

  // La sélection ne survit ni à la fin du tour, ni à une main qui change sous nos pieds
  // (l'échange lui-même, un objet volé par une carte adverse) : sans ça, on garderait des
  // ids devenus inconnus et le bouton « Échanger » proposerait un envoi voué au refus.
  useEffect(() => {
    if (recycleUnavailable) {
      setRecycling(false);
      setSelected([]);
      return;
    }
    setSelected((prev) => {
      const kept = prev.filter((id) => player.unplayedObjectInstanceIds.includes(id));
      return kept.length === prev.length ? prev : kept;
    });
  }, [recycleUnavailable, player.unplayedObjectInstanceIds]);

  const toggle = (instanceId: string) => {
    setSelected((prev) =>
      prev.includes(instanceId)
        ? prev.filter((id) => id !== instanceId)
        : prev.length >= RECYCLE_OBJECT_COST
          ? prev // le plafond est atteint : décocher d'abord, plutôt que remplacer en silence
          : [...prev, instanceId]
    );
  };

  const submit = () => {
    onRecycle(selected);
    setSelected([]);
    setRecycling(false);
  };

  // Le refus global (pas votre tour, quota d'objets épuisé) prime : il empêche de jouer
  // quoi que ce soit. Sinon, la carte affiche sa propre raison de ne rien pouvoir cibler.
  const denialFor = (slot: HandSlot): string | null => {
    // En sélection, ce sont les refus du RECYCLAGE qui comptent, pas ceux du jeu : un objet
    // dont l'effet n'a rien à cibler reste parfaitement recyclable, et un terrain ne l'est
    // jamais, même quand il serait posable.
    if (recycling) return slot.kind === 'object' ? null : 'Objets uniquement';
    if (slot.kind === 'terrain') return terrainDenial;
    if (slot.kind === 'hidden') return null;
    return objectDenial ?? objectCardDenial(state, you, slot.id);
  };

  // Une carte que `getPlayerView` a caviardée n'est jamais notre propre main : elle est
  // écartée d'emblée pour que l'index de l'arc et le compte affiché portent sur les seules
  // cartes réellement dessinées.
  type PlayableSlot = Extract<HandSlot, { kind: 'object' | 'terrain' }>;
  const visible = slots.filter((slot): slot is PlayableSlot => slot.kind !== 'hidden');
  const objects = visible.filter((slot) => slot.kind === 'object');
  const terrains = visible.filter((slot) => slot.kind === 'terrain');

  const card = (slot: PlayableSlot, index: number) => (
    <PlayerHandCard
      key={slot.id}
      slot={slot}
      index={index}
      count={visible.length}
      disabledReason={denialFor(slot)}
      recycle={
        recycling && slot.kind === 'object'
          ? { selected: selected.includes(slot.id), onToggle: () => toggle(slot.id) }
          : null
      }
      onPlay={() => (slot.kind === 'object' ? onPlayObject(slot.id) : onPlayTerrain(slot.id))}
      onBlocked={onBlocked}
    />
  );

  return (
    <div className="hand-dock">
      <RecyclerZone
        denial={recycleUnavailable}
        selectedCount={selected.length}
        open={recycling}
        onOpen={() => setRecycling(true)}
        onCancel={() => {
          setRecycling(false);
          setSelected([]);
        }}
        onSubmit={submit}
        onBlocked={onBlocked}
      />
      <div
        className={`hand-fan${recycling ? ' recycling' : ''}`}
        style={fanSpread(visible.length)}
        role="group"
        aria-label="Votre main"
      >
        {visible.length === 0 && <span className="hand-strip-empty">Main vide</span>}
        {objects.map((slot, i) => card(slot, i))}
        {/* Les deux paquets ne se jouent pas pareil et n'ont pas le même quota par tour :
            un intercalaire les sépare pour qu'on trouve un terrain sans lire les onze
            cartes. Décoratif -- l'ordre du DOM porte déjà l'information. */}
        {objects.length > 0 && terrains.length > 0 && <span className="hand-fan-split" aria-hidden="true" />}
        {terrains.map((slot, i) => card(slot, objects.length + i))}
      </div>
    </div>
  );
}

function RevealedHandTile({
  cardId,
  kind,
  subtitle = 'Révélée dans la main adverse',
}: {
  cardId: string;
  kind: 'object' | 'terrain' | 'character';
  subtitle?: string;
}) {
  // Les trois types ont chacun leur lecteur : passer un personnage au lecteur de terrain
  // faisait planter l'interface entière ("Card X is not a terrain card").
  const name = kind === 'object' ? objectName(cardId) : kind === 'terrain' ? terrainName(cardId) : characterName(cardId);
  const body =
    kind === 'object' ? objectDetailBody(cardId) : kind === 'terrain' ? terrainDetailBody(cardId) : characterDetailBody(cardId);
  const inspect = useCardInspect({ title: name, subtitle, card: { cardId, kind, name }, body });
  return <CardFrame cardId={cardId} kind={kind} name={name} size="small" {...inspect} />;
}

function HiddenHandTile() {
  const inspect = useCardInspect({ title: 'Carte cachée', body: hiddenCardDetailBody() });
  return (
    <div className="hand-strip-hidden" onClick={inspect.onClick} {...inspect.hoverProps}>
      <FaceDownCard />
    </div>
  );
}

/**
 * La main adverse, alignée tout en haut. Dos de cartes par défaut ; une carte dont
 * l'instance nous parvient (un passif ou une capacité qui révèle le jeu adverse) est
 * simplement affichée face visible.
 */
/**
 * Mode Pioche : la **Main Personnage**, les personnages piochés banc plein. Ce n'est pas une
 * main jouable -- on n'en pose rien soi-même, ils descendent au banc dès qu'une place se
 * libère -- d'où une bande à part, en lecture seule, et non des slots de la main d'objets.
 *
 * Chez l'adversaire, les identités sont caviardées par `getPlayerView` : on ne voit que le
 * nombre, comme pour les objets non joués.
 */
export function CharacterHand({
  player,
  isSelf,
  max,
}: {
  player: PlayerState;
  isSelf: boolean;
  max: number;
}) {
  const ids = player.handCharacterInstanceIds;
  if (ids.length === 0 && !isSelf) return null;

  return (
    <div className="character-hand" role="group" aria-label="Main Personnage">
      <span className="character-hand-label">
        Main perso <strong>{ids.length}/{max}</strong>
      </span>
      <div className="character-hand-row">
        {ids.length === 0 && <span className="hand-strip-empty">vide</span>}
        {ids.map((id) => {
          const char = player.characters[id];
          return (
            <div className="hand-strip-slot" key={id}>
              {char ? (
                <RevealedHandTile cardId={char.cardId} kind="character" subtitle="En attente d'une place au banc" />
              ) : (
                <HiddenHandTile />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OpponentHand({ player }: { player: PlayerState }) {
  const slots = handSlots(player);

  return (
    <div className="hand-strip opponent-hand" role="group" aria-label="Main de l'adversaire">
      {slots.length === 0 && <span className="hand-strip-empty">Main vide</span>}
      {slots.map((slot) => (
        <div className="hand-strip-slot" key={slot.id}>
          {slot.kind === 'hidden' ? <HiddenHandTile /> : <RevealedHandTile cardId={slot.cardId} kind={slot.kind} />}
        </div>
      ))}
    </div>
  );
}
