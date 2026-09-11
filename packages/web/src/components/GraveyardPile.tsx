import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CharacterInstance, ObjectInstance, PlayerState, TerrainInstance } from 'engine';
import { graveyardRectKey, trackCardRect } from './cardRects';
import { CardArt } from './CardArt';
import { CardFrame } from './CardFrame';
import { CharacterCard } from './CharacterCard';
import { useCardInspect } from './HoverCard';
import { objectDetailBody, terrainDetailBody } from './cardDetails';
import { objectName, terrainName } from './boardActions';

/**
 * Un objet / terrain consommé, tel qu'il apparaît dans la modale du cimetière : la même
 * tuile qu'en main, mais éteinte et inerte -- seule sa description reste accessible.
 */
function DeadCardTile({ cardId, kind }: { cardId: string; kind: 'object' | 'terrain' }) {
  const name = kind === 'object' ? objectName(cardId) : terrainName(cardId);
  const inspect = useCardInspect({
    title: name,
    subtitle: kind === 'object' ? 'Objet au cimetière' : 'Terrain au cimetière',
    card: { cardId, kind, name },
    body: kind === 'object' ? objectDetailBody(cardId) : terrainDetailBody(cardId),
  });
  return <CardFrame cardId={cardId} kind={kind} name={name} size="small" dimmed {...inspect} />;
}

interface GraveyardContents {
  characters: CharacterInstance[];
  objects: ObjectInstance[];
  terrains: TerrainInstance[];
  total: number;
  /** Illustration montrée sur le dessus de la pile : la dernière carte à y être tombée. */
  topCard?: { cardId: string; kind: 'character' | 'object' | 'terrain' };
}

// Les objets et les terrains ont leur propre pile de cimetière (un objet à usage unique y
// tombe le tour où il se résout, un terrain quand il expire / est remplacé / est détruit).
// Les ids dont l'instance n'est pas dans la vue sont ignorés par prudence -- `getPlayerView`
// ne caviarde que la réserve *non jouée* de l'adversaire, donc en pratique tout se résout.
function readGraveyard(player: PlayerState): GraveyardContents {
  const characters = player.graveyardCharacterInstanceIds
    .map((id) => player.characters[id])
    .filter((c): c is CharacterInstance => c !== undefined);
  const objects = player.graveyardObjectInstanceIds
    .map((id) => player.objects[id])
    .filter((o): o is ObjectInstance => o !== undefined);
  const terrains = player.graveyardTerrainInstanceIds
    .map((id) => player.terrains[id])
    .filter((t): t is TerrainInstance => t !== undefined);

  const last =
    terrains.length > 0
      ? ({ cardId: terrains[terrains.length - 1]!.cardId, kind: 'terrain' } as const)
      : objects.length > 0
        ? ({ cardId: objects[objects.length - 1]!.cardId, kind: 'object' } as const)
        : characters.length > 0
          ? ({ cardId: characters[characters.length - 1]!.cardId, kind: 'character' } as const)
          : undefined;

  return {
    characters,
    objects,
    terrains,
    total: characters.length + objects.length + terrains.length,
    topCard: last,
  };
}

function GraveyardModal({ contents, title, onClose }: { contents: GraveyardContents; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    // Le focus entre dans la modale avec elle : sans ça, Tab continuait de parcourir le
    // plateau derrière le voile, et Échap restait le seul moyen d'en sortir au clavier.
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const sections: { key: string; label: string; unit: string; count: number; cards: ReactNode }[] = [
    {
      key: 'characters',
      label: 'Personnages',
      unit: 'perso',
      count: contents.characters.length,
      cards: contents.characters.map((char) => (
        <CharacterCard key={char.instanceId} char={char} isActive={false} isKOable size="small" />
      )),
    },
    {
      key: 'objects',
      label: 'Objets',
      unit: 'objet',
      count: contents.objects.length,
      cards: contents.objects.map((obj) => <DeadCardTile key={obj.instanceId} cardId={obj.cardId} kind="object" />),
    },
    {
      key: 'terrains',
      label: 'Terrains',
      unit: 'terrain',
      count: contents.terrains.length,
      cards: contents.terrains.map((terrain) => <DeadCardTile key={terrain.instanceId} cardId={terrain.cardId} kind="terrain" />),
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal graveyard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="graveyard-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="graveyard-modal-head">
          <h3 id="graveyard-modal-title">
            {title} <span className="graveyard-modal-count">{contents.total}</span>
          </h3>
          {/* Le détail par famille en tête, pour ne pas avoir à dérouler la liste. */}
          <span className="graveyard-modal-tally" aria-hidden="true">
            {sections.map((s) => (
              <span key={s.key} className={s.count === 0 ? 'empty' : undefined}>
                {s.count} {s.unit}
                {s.count > 1 ? 's' : ''}
              </span>
            ))}
          </span>
          <button ref={closeRef} className="hover-card-close graveyard-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="graveyard-modal-scroll">
          {contents.total === 0 && <p className="graveyard-modal-empty">Le cimetière est vide.</p>}

          {/* Les trois familles sont toujours listées, dans le même ordre, même vides : la
              liste garde la même forme d'une ouverture à l'autre et se lit d'un coup d'oeil. */}
          {contents.total > 0 &&
            sections.map((s) => (
              <section key={s.key} className={`graveyard-modal-section${s.count === 0 ? ' empty' : ''}`}>
                <h4>
                  {s.label} <span className="graveyard-modal-section-count">{s.count}</span>
                </h4>
                {s.count > 0 ? <div className="graveyard-modal-grid">{s.cards}</div> : <p className="graveyard-modal-empty">Aucun</p>}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

/** La pile du cimetière : un dos de carte empilé, cliquable, qui ouvre son contenu en modale. */
export function GraveyardPile({
  player,
  title,
  orientation = 'portrait',
}: {
  player: PlayerState;
  title: string;
  orientation?: 'portrait' | 'landscape';
}) {
  const [open, setOpen] = useState(false);
  const contents = readGraveyard(player);

  // Destination du vol d'une carte qui vient de mourir (cf. `KoFlight.tsx`).
  const pileRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    trackCardRect(graveyardRectKey(player.id), pileRef.current);
  });

  // À la fermeture, le focus revient sur la pile : c'est de là qu'on est parti, et sans ce
  // retour il tombait sur `body`, au début du plateau, pour qui navigue au clavier.
  const close = useCallback(() => {
    setOpen(false);
    pileRef.current?.focus();
  }, []);

  const parts = [
    contents.characters.length > 0 ? `${contents.characters.length} perso${contents.characters.length > 1 ? 's' : ''}` : null,
    contents.objects.length > 0 ? `${contents.objects.length} objet${contents.objects.length > 1 ? 's' : ''}` : null,
    contents.terrains.length > 0 ? `${contents.terrains.length} terrain${contents.terrains.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean);
  const summary =
    contents.total === 0 ? 'vide' : `${contents.total} carte${contents.total > 1 ? 's' : ''} (${parts.join(', ')})`;

  return (
    <div className="graveyard-pile-zone">
      <span className="zone-label">Cimetière</span>
      <button
        ref={pileRef}
        className={`graveyard-pile graveyard-pile-${orientation}${contents.total === 0 ? ' empty' : ''}`}
        onClick={() => setOpen(true)}
        title={`${title} — ${summary}`}
        aria-label={`${title} — ${summary}. Ouvrir la liste`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {contents.topCard ? (
          <CardArt cardId={contents.topCard.cardId} kind={contents.topCard.kind} />
        ) : (
          <span className="graveyard-pile-empty-icon" aria-hidden="true">
            ⚰️
          </span>
        )}
        {/* Le nombre reste affiché même à zéro : une pile sans chiffre se lit comme une
            pile dont on n'a pas encore l'information. */}
        <span className="graveyard-pile-count" aria-hidden="true">
          {contents.total}
        </span>
      </button>
      {open && <GraveyardModal contents={contents} title={title} onClose={close} />}
    </div>
  );
}
