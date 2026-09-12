import { useEffect, useState } from 'react';

/**
 * Durée du fondu enchaîné, en ms. Doit suivre `--board-backdrop-fade` dans `styles.css` : le
 * calque sortant est retiré du DOM à l'échéance de ce délai, et un retrait plus tôt que la
 * fin de la transition couperait le fondu net.
 */
const FADE_MS = 900;

interface Layer {
  id: number;
  src: string;
  /** Calque en train de s'estomper : il ne sert plus qu'au fondu, et sera retiré du DOM. */
  leaving: boolean;
}

/**
 * Image de fond du plateau, derrière tout le contenu. Sans `src`, ne dessine rien : c'est
 * l'arène sombre de `.board` qui se voit.
 *
 * Le changement d'image est un fondu enchaîné à deux calques (l'ancien s'efface pendant
 * que le nouveau apparaît) plutôt qu'un simple remplacement de `background-image`, que le
 * navigateur ne sait pas animer. Et le nouveau calque n'est monté qu'une fois l'image
 * réellement chargée (`new Image()`) : sinon le fondu partait sur un rectangle vide et
 * l'image « claquait » au milieu. Une image qui ne charge pas (PNG absent pour un terrain
 * sans illustration, URL cassée saisie par le joueur) revient simplement au fond par défaut.
 *
 * Le calque est en `z-index: -2` dans le contexte d'empilement isolé de `.board` : sous
 * la grille holographique (`::before`, -1) et la teinte du terrain (`::after`, -1), mais
 * au-dessus du fond propre de `.board`, que le navigateur peint toujours en premier.
 */
export function BoardBackdrop({ src }: { src: string | null }) {
  const [layers, setLayers] = useState<Layer[]>([]);

  useEffect(() => {
    // Rien à montrer : tout ce qui est affiché s'estompe vers le fond par défaut.
    if (!src) {
      setLayers((prev) => prev.map((layer) => (layer.leaving ? layer : { ...layer, leaving: true })));
      return;
    }
    // Un `src` qui n'a pas changé de valeur (re-rendu du plateau) ne redéclenche rien :
    // l'image est déjà là, un second fondu ne ferait que la faire clignoter.
    const current = layers.find((layer) => !layer.leaving);
    if (current?.src === src) return;

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      setLayers((prev) => [
        ...prev.map((layer) => (layer.leaving ? layer : { ...layer, leaving: true })),
        { id: Date.now() + Math.random(), src, leaving: false },
      ]);
    };
    probe.onerror = () => {
      if (cancelled) return;
      setLayers((prev) => prev.map((layer) => (layer.leaving ? layer : { ...layer, leaving: true })));
    };
    probe.src = src;
    // `src` a rechangé avant la fin du chargement : ce résultat ne vaut plus rien, seul le
    // dernier demandé compte -- sans ça, deux réponses dans le désordre affichaient
    // l'ancienne image par-dessus la nouvelle.
    return () => {
      cancelled = true;
    };
    // Dépendance sur `src` seul, volontairement : `layers` n'est lu que pour
    // court-circuiter un `src` identique, et le relire à chaque changement de calques
    // relancerait un préchargement à chaque fondu.
  }, [src]);

  // Les calques qui s'effacent sont retirés à la fin du fondu. Un délai plutôt que
  // `onTransitionEnd` : sous `prefers-reduced-motion`, il n'y a pas de transition et
  // l'événement ne partirait jamais -- le calque resterait dans le DOM pour toute la partie.
  useEffect(() => {
    if (!layers.some((layer) => layer.leaving)) return;
    const timer = window.setTimeout(() => {
      setLayers((prev) => prev.filter((layer) => !layer.leaving));
    }, FADE_MS + 100);
    return () => window.clearTimeout(timer);
  }, [layers]);

  if (layers.length === 0) return null;
  return (
    <div className="board-backdrop" aria-hidden="true">
      {layers.map((layer) => (
        <div key={layer.id} className={`board-backdrop-layer${layer.leaving ? ' leaving' : ''}`}>
          {/* L'image est floutée et assombrie pour rester un décor : les cartes doivent se lire
              par-dessus. Le `scale` compense le bord clair que le flou laisserait sinon sur le
              pourtour (les pixels flous y sont mélangés avec du vide). */}
          <div className="board-backdrop-image" style={{ backgroundImage: `url("${layer.src}")` }} />
          <div className="board-backdrop-vignette" />
        </div>
      ))}
    </div>
  );
}
