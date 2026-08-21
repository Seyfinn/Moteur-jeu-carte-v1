import type { RosterConfig } from '../../match.js';

let registered = false;

/**
 * Formerly registered the engine's demo/example cards. All of them were test
 * content and have been removed; the game's real card pool has not been
 * written yet. Kept as a no-op so callers (server/web bootstrap) don't need
 * to change until real cards are registered here.
 */
export function registerDemoCards(): void {
  if (registered) return;
  registered = true;
}

export const DEMO_ROSTER: RosterConfig = {
  characterCardIds: [],
  objectCardIds: [],
  terrainCardIds: [],
};
