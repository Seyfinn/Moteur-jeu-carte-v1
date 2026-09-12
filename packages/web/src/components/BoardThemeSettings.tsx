import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { saveBoardTheme, useBoardTheme, type BoardThemeMode } from '../boardTheme';

/**
 * Panneau de personnalisation du fond de plateau, ouvert depuis le lobby ou depuis la
 * barre du haut en partie. Il n'a qu'un seul état à gérer, celui de `boardTheme.ts` :
 * le mode (automatique / personnalisé) et l'image importée. Le plateau (`Board.tsx`) lit
 * le même module et se met à jour tout seul à chaque sauvegarde.
 *
 * Le réglage vit dans `localStorage`, donc sur CET appareil : une image importée ne part
 * jamais vers le serveur ni vers l'adversaire, et un autre navigateur ne la verra pas.
 */

/**
 * Bornes de l'image stockée. `localStorage` plafonne autour de 5 Mo par origine, et une
 * photo de téléphone lue telle quelle en data URL en fait facilement 8 à 12 : on la
 * redessine dans un canvas à une taille suffisante pour un fond flouté en plein écran,
 * puis on descend la qualité JPEG jusqu'à tenir dans un budget confortable -- les decks
 * partagent le même stockage, il ne faut pas tout manger.
 */
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1920;
const JPEG_QUALITIES = [0.85, 0.7, 0.55];
/** Longueur maximale visée pour la data URL (en caractères, ~= octets pour du base64). */
const DATA_URL_BUDGET = 3_500_000;

const ERROR_TOO_HEAVY = "Image trop lourde pour être enregistrée sur cet appareil. Essayez une image plus petite.";
const ERROR_UNREADABLE = "Impossible de lire cette image. Formats acceptés : JPEG, PNG, WebP, GIF.";
const ERROR_BAD_URL = 'Adresse invalide : elle doit commencer par http:// ou https://.';

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

/**
 * Redimensionne et recompresse un fichier local pour qu'il tienne dans `localStorage`.
 * Renvoie une data URL JPEG. Le JPEG n'a pas de couche alpha : les zones transparentes
 * d'un PNG sont posées sur du noir, ce qui est de toute façon la couleur du plateau
 * derrière le fond assombri.
 */
async function shrinkImageFile(file: File): Promise<string> {
  const raw = await readFileAsDataURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(raw);
  } catch {
    throw new Error(ERROR_UNREADABLE);
  }
  const scale = Math.min(1, MAX_IMAGE_WIDTH / img.naturalWidth, MAX_IMAGE_HEIGHT / img.naturalHeight);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(ERROR_UNREADABLE);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let out = '';
  for (const quality of JPEG_QUALITIES) {
    out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= DATA_URL_BUDGET) return out;
  }
  // Même à la qualité la plus basse c'est trop gros : on laisse `saveBoardTheme` trancher,
  // il renverra `false` si le stockage refuse et le panneau le dira au joueur.
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function BoardThemePanel({ onClose }: { onClose: () => void }) {
  const theme = useBoardTheme();
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [urlDraft, setUrlDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Une URL distante peut tout simplement ne pas charger (lien mort, site qui refuse le
  // hotlinking) : l'aperçu le dit plutôt que de laisser un cadre vide sans explication.
  const [previewBroken, setPreviewBroken] = useState(false);

  // Échap ferme le panneau, comme les autres.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Le focus entre dans le panneau à l'ouverture et revient sur le bouton d'origine à la
  // fermeture, pour qu'un joueur au clavier ne retombe pas sur `body`.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => setPreviewBroken(false), [theme.customImage]);

  const hasImage = theme.customImage !== null;

  const setMode = (mode: BoardThemeMode) => {
    setError(null);
    if (!saveBoardTheme({ ...theme, mode })) setError(ERROR_TOO_HEAVY);
  };

  // Choisir une image, c'est vouloir la voir : le mode bascule en `custom` dans le même
  // geste, sinon le joueur importe, ferme, et ne comprend pas pourquoi rien ne change.
  const applyImage = (customImage: string) => {
    if (saveBoardTheme({ mode: 'custom', customImage })) {
      setError(null);
    } else {
      setError(ERROR_TOO_HEAVY);
    }
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Remis à zéro tout de suite : re-choisir le MÊME fichier après une erreur doit
    // redéclencher `change`, ce que le navigateur ne fait pas si la valeur n'a pas bougé.
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      applyImage(await shrinkImageFile(file));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : ERROR_UNREADABLE);
    } finally {
      setBusy(false);
    }
  };

  const onUrlSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = urlDraft.trim();
    if (!isHttpUrl(value)) {
      setError(ERROR_BAD_URL);
      return;
    }
    applyImage(value);
    setUrlDraft('');
  };

  const removeImage = () => {
    setError(null);
    saveBoardTheme({ mode: 'auto', customImage: null });
  };

  // Portail vers `document.body`, comme le glossaire et le guide : le bouton qui ouvre ce
  // panneau vit soit dans `.board-header` (clip-path + backdrop-filter, qui confinent tout
  // `position: fixed`), soit dans le lobby et ses calques empilés.
  return createPortal(
    <div className="modal-backdrop glossary-backdrop" onClick={onClose}>
      <div
        className="modal glossary-panel board-theme-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glossary-header">
          <h3 id={`${uid}-title`}>Fond du plateau</h3>
          <button
            ref={closeRef}
            className="hover-card-close"
            onClick={onClose}
            aria-label="Fermer le panneau (Échap)"
            title="Fermer (Échap)"
          >
            ×
          </button>
          <p className="board-theme-help">
            Choisissez ce que le plateau affiche derrière les cartes. Le réglage est enregistré sur cet
            appareil uniquement : votre image n'est envoyée ni au serveur, ni à l'adversaire.
          </p>
        </header>

        <div className="glossary-scroll board-theme-scroll">
          <fieldset className="board-theme-modes">
            <legend className="board-theme-label">Thème</legend>
            <label className={`board-theme-mode${theme.mode === 'auto' ? ' selected' : ''}`}>
              <input
                type="radio"
                name={`${uid}-mode`}
                value="auto"
                checked={theme.mode === 'auto'}
                onChange={() => setMode('auto')}
              />
              <span className="board-theme-mode-icon" aria-hidden="true">
                🗺️
              </span>
              <span className="board-theme-mode-text">
                <strong>Automatique</strong>
                <small>S'adapte au terrain joué en partie.</small>
              </span>
            </label>
            <label
              className={`board-theme-mode${theme.mode === 'custom' ? ' selected' : ''}${hasImage ? '' : ' disabled'}`}
              title={hasImage ? undefined : 'Importez d’abord une image ci-dessous'}
            >
              <input
                type="radio"
                name={`${uid}-mode`}
                value="custom"
                checked={theme.mode === 'custom'}
                disabled={!hasImage}
                onChange={() => setMode('custom')}
              />
              <span className="board-theme-mode-icon" aria-hidden="true">
                🖼️
              </span>
              <span className="board-theme-mode-text">
                <strong>Personnalisé</strong>
                <small>Utilise votre image, quel que soit le terrain.</small>
              </span>
            </label>
          </fieldset>

          <section className="board-theme-import" aria-labelledby={`${uid}-import`}>
            <h4 id={`${uid}-import`} className="board-theme-label">
              Votre image
            </h4>
            <div className="board-theme-import-row">
              <input
                ref={fileRef}
                id={`${uid}-file`}
                className="board-theme-file"
                type="file"
                accept="image/*"
                onChange={onFileChange}
                disabled={busy}
              />
              <label htmlFor={`${uid}-file`} className={`board-theme-file-button${busy ? ' busy' : ''}`}>
                📁 {busy ? 'Traitement…' : 'Importer un fichier'}
              </label>
              <span className="board-theme-or" aria-hidden="true">
                ou
              </span>
              <form className="board-theme-url" onSubmit={onUrlSubmit}>
                <input
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://…/image.jpg"
                  aria-label="Adresse d'une image en ligne"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                />
                <button type="submit" disabled={!urlDraft.trim() || busy}>
                  Utiliser
                </button>
              </form>
            </div>
            <p className="board-theme-hint">
              Un fichier local est réduit à {MAX_IMAGE_WIDTH} px de large avant d'être enregistré. Une adresse en
              ligne doit rester accessible : l'image est rechargée à chaque partie.
            </p>
            {error && (
              <p className="board-theme-error" role="alert">
                {error}
              </p>
            )}
          </section>

          <section className="board-theme-preview-section" aria-labelledby={`${uid}-preview`}>
            <h4 id={`${uid}-preview`} className="board-theme-label">
              Aperçu
            </h4>
            {hasImage ? (
              <>
                <div className="board-theme-previews">
                  <figure className="board-theme-preview">
                    <div className="board-theme-preview-frame">
                      {previewBroken ? (
                        <span className="board-theme-preview-broken">Image introuvable</span>
                      ) : (
                        <img src={theme.customImage ?? undefined} alt="" onError={() => setPreviewBroken(true)} />
                      )}
                    </div>
                    <figcaption>Votre image</figcaption>
                  </figure>
                  <figure className="board-theme-preview">
                    {/* Même traitement que le plateau (assombri et flouté) : c'est ÇA que le
                        joueur verra derrière ses cartes, pas l'image telle quelle. */}
                    <div className="board-theme-preview-frame on-board">
                      {!previewBroken && <img src={theme.customImage ?? undefined} alt="" />}
                      <span className="board-theme-preview-card" aria-hidden="true" />
                      <span className="board-theme-preview-card" aria-hidden="true" />
                    </div>
                    <figcaption>Sur le plateau</figcaption>
                  </figure>
                </div>
                <div className="board-theme-actions">
                  <button type="button" className="board-theme-remove" onClick={removeImage}>
                    🗑 Supprimer l'image
                  </button>
                </div>
              </>
            ) : (
              <p className="board-theme-empty">Aucune image importée : le plateau suit le terrain en jeu.</p>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Bouton « Fond » + le panneau qu'il ouvre. Rendu dans la barre du haut du plateau (à côté
 * du glossaire) et dans le lobby : sans `className`, il prend l'habillage des boutons du
 * HUD ; le lobby lui passe le sien.
 */
export function BoardThemeButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? 'board-leave glossary-button board-theme-button'}
        onClick={() => setOpen(true)}
        title="Personnaliser le fond du plateau"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Sous 760px, le libellé s'efface dans la barre du plateau (déjà pleine) mais pas
            au lobby, où le bouton a toute la largeur : voir `.board-theme-button-label`. */}
        🖼️<span className="board-theme-button-label"> Fond</span>
      </button>
      {open && <BoardThemePanel onClose={() => setOpen(false)} />}
    </>
  );
}
