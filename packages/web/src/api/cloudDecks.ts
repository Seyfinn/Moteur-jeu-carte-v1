import type { RosterConfig } from 'engine';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

const USERNAME_KEY = 'ctg-cloud-username';

export function getCloudUserName(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCloudUserName(name: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export interface CloudDeck {
  deckName: string;
  roster: RosterConfig;
}

export async function saveDeckToCloud(
  userName: string,
  deckName: string,
  roster: RosterConfig
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/decks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName, deckName, roster }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error ?? 'Erreur serveur' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Connexion au serveur impossible.' };
  }
}

export async function loadDecksFromCloud(userName: string): Promise<{ ok: boolean; decks?: CloudDeck[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/decks?userName=${encodeURIComponent(userName)}`);
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error ?? 'Erreur serveur' };
    return { ok: true, decks: body.decks ?? [] };
  } catch {
    return { ok: false, error: 'Connexion au serveur impossible.' };
  }
}
