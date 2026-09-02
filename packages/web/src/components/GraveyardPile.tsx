import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal graveyard-modal" onClick={(e) => e.stopPropagation()}>
        <header className="graveyard-modal-head">
          <h3>
            {title} <span className="graveyard-modal-count">{contents.total}</span>
          </h3>
          <button className="hover-card-close graveyard-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="graveyard-modal-scroll">
          {contents.total === 0 && <p className="graveyard-modal-empty">Le cimetière est vide.</p>}

          {contents.characters.length > 0 && (
            <section className="graveyard-modal-section">
              <h4>Personnages ({contents.characters.length})</h4>
              <div className="graveyard-modal-grid">
                {contents.characters.map((char) => (
                  <CharacterCard key={char.instanceId} char={char} isActive={false} isKOable size="small" />
                ))}
              </div>
            </section>
          )}

          {contents.objects.length > 0 && (
            <section className="graveyard-modal-section">
              <h4>Objets ({contents.objects.length})</h4>
              <div className="graveyard-modal-grid">
                {contents.objects.map((obj) => (
                  <DeadCardTile key={obj.instanceId} cardId={obj.cardId} kind="object" />
                ))}
              </div>
            </section>
          )}

          {contents.terrains.length > 0 && (
            <section className="graveyard-modal-section">
              <h4>Terrains ({contents.terrains.length})</h4>
              <div className="graveyard-modal-grid">
                {contents.terrains.map((terrain) => (
                  <DeadCardTile key={terrain.instanceId} cardId={terrain.cardId} kind="terrain" />
                ))}
              </div>
            </section>
          )}
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

  return (
    <div className="graveyard-pile-zone">
      <span className="zone-label">Cimetière</span>
      <button
        ref={pileRef}
        className={`graveyard-pile graveyard-pile-${orientation}${contents.total === 0 ? ' empty' : ''}`}
        onClick={() => setOpen(true)}
        title={`${title} — ${contents.total} carte${contents.total > 1 ? 's' : ''}`}
      >
        {contents.topCard ? (
          <CardArt cardId={contents.topCard.cardId} kind={contents.topCard.kind} />
        ) : (
          <span className="graveyard-pile-empty-icon">⚰️</span>
        )}
        <span className="graveyard-pile-count">{contents.total}</span>
      </button>
      {open && <GraveyardModal contents={contents} title={title} onClose={() => setOpen(false)} />}
    </div>
  );
}
