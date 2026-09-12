import { useEffect, useState } from 'react';

/**
 * Préférence de fond de plateau, partagée entre le panneau de réglages (qui l'écrit) et le
 * plateau (qui la lit).
 *
 * - `auto` : le plateau prend l'illustration du terrain en jeu, et retombe sur l'arène
 *   sombre par défaut quand il n'y en a pas.
 * - `custom` : le plateau affiche l'image importée par le joueur (`customImage`), quel que
 *   soit le terrain posé. Sans image importée, `custom` se comporte comme `auto`.
 *
 * `customImage` est soit une data URL (fichier local lu via FileReader), soit une URL
 * http(s) saisie par le joueur. Elle vit dans `localStorage` : c'est un réglage de
 * l'appareil, pas du compte -- comme les decks (`decks.ts`).
 */
export type BoardThemeMode = 'auto' | 'custom';

export interface BoardTheme {
  mode: BoardThemeMode;
  customImage: string | null;
}

const STORAGE_KEY = 'tcg.boardTheme.v1';
/** Émis sur `window` à chaque sauvegarde, pour que tous les `useBoardTheme` se resynchronisent. */
const CHANGE_EVENT = 'tcg:board-theme-change';

export const DEFAULT_BOARD_THEME: BoardTheme = { mode: 'auto', customImage: null };

export function loadBoardTheme(): BoardTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOARD_THEME;
    const parsed = JSON.parse(raw) as Partial<BoardTheme>;
    const mode: BoardThemeMode = parsed.mode === 'custom' ? 'custom' : 'auto';
    const customImage = typeof parsed.customImage === 'string' && parsed.customImage ? parsed.customImage : null;
    return { mode, customImage };
  } catch {
    return DEFAULT_BOARD_THEME;
  }
}

/**
 * Sauvegarde et notifie. Renvoie `false` si le stockage a refusé (quota dépassé : une
 * data URL d'image lourde peut dépasser les ~5 Mo de `localStorage`) -- l'appelant doit
 * alors le dire au joueur plutôt que de faire comme si c'était enregistré.
 */
export function saveBoardTheme(theme: BoardTheme): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

/** Lecture réactive de la préférence : se met à jour dès qu'un autre composant la sauvegarde. */
export function useBoardTheme(): BoardTheme {
  const [theme, setTheme] = useState<BoardTheme>(loadBoardTheme);
  useEffect(() => {
    const sync = () => setTheme(loadBoardTheme());
    window.addEventListener(CHANGE_EVENT, sync);
    // Un autre onglet qui change le réglage : `storage` ne part que vers les AUTRES onglets.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return theme;
}
