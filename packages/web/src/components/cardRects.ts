/**
 * Dernière position connue à l'écran de chaque carte de personnage et de chaque pile de
 * cimetière.
 *
 * Elle existe pour une seule raison : quand un personnage tombe, le moteur l'envoie au
 * cimetière dans le MÊME état que celui qui annonce le KO. Sa carte est donc déjà démontée
 * quand l'animation de mort veut démarrer, et il n'y a plus rien à mesurer. Chaque carte
 * dépose donc son rectangle à chaque rendu, et l'animation lit le dernier connu.
 *
 * Volontairement en dehors de React : c'est un cache d'effet de bord, jamais une source de
 * rendu -- l'y mettre déclencherait un rendu à chaque mesure, qui déclencherait une mesure.
 */
const rects = new Map<string, DOMRect>();

/** Clé de la pile de cimetière d'un camp, destination du vol d'une carte morte. */
export function graveyardRectKey(playerId: string): string {
  return `graveyard:${playerId}`;
}

/** Relève la position de `el`, ou oublie la clé quand l'élément a disparu. */
export function trackCardRect(key: string, el: HTMLElement | null): void {
  if (!el) return;
  rects.set(key, el.getBoundingClientRect());
}

export function readCardRect(key: string): DOMRect | undefined {
  return rects.get(key);
}
