import type { RoomSummary } from 'engine';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/**
 * Salons en attente d'un adversaire. Sert au lobby à les proposer d'un clic : sans ça, le
 * seul moyen d'entrer quelque part était de se faire dicter le code à deux lettres.
 */
export async function listOpenRooms(): Promise<{ ok: boolean; rooms?: RoomSummary[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/rooms`);
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error ?? 'Erreur serveur' };
    return { ok: true, rooms: Array.isArray(body.rooms) ? body.rooms : [] };
  } catch {
    return { ok: false, error: 'Connexion au serveur impossible.' };
  }
}
