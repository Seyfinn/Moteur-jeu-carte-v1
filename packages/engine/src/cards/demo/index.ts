import { registerCard } from '../registry.js';
import type { RosterConfig } from '../../match.js';
import { nakime } from './nakime.js';
import { gilgameshV } from './gilgamesh-v.js';
import { kashimoV } from './kashimo-v.js';
import { gogetaBlueV } from './gogeta-blue-v.js';
import { beyondNeteroVmax } from './beyond-netero-vmax.js';
import { batmanV } from './batman-v.js';
import { allieIndomptable } from './allie-indomptable.js';
import { terrainDomaineQuincy } from './terrain-domaine-quincy.js';
import { katarina } from './katarina.js';

export {
  nakime,
  gilgameshV,
  kashimoV,
  gogetaBlueV,
  beyondNeteroVmax,
  batmanV,
  allieIndomptable,
  terrainDomaineQuincy,
  katarina,
};

let registered = false;

/**
 * These 8 cards are demo/example content used to prove the engine can
 * handle a wide range of mechanics (coin-flip loops, valeur lock, on-attack
 * and on-KO triggers, dodge, terrain auras, frequency overrides, bench
 * protection, cloning, ...). They are not the game's final card pool.
 */
export function registerDemoCards(): void {
  if (registered) return;
  registered = true;
  registerCard(nakime);
  registerCard(gilgameshV);
  registerCard(kashimoV);
  registerCard(gogetaBlueV);
  registerCard(beyondNeteroVmax);
  registerCard(batmanV);
  registerCard(allieIndomptable);
  registerCard(terrainDomaineQuincy);
  registerCard(katarina);
}

export const DEMO_ROSTER: RosterConfig = {
  characterCardIds: [
    nakime.id,
    gilgameshV.id,
    kashimoV.id,
    gogetaBlueV.id,
    beyondNeteroVmax.id,
    batmanV.id,
    katarina.id,
  ],
  objectCardIds: [allieIndomptable.id],
  terrainCardIds: [terrainDomaineQuincy.id],
};
