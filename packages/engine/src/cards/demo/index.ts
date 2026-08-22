import type { RosterConfig } from '../../match.js';
import { registerCard } from '../registry.js';
import { blitzcrank } from './blitzcrank.js';
import { caitlyn } from './caitlyn.js';
import { guts } from './guts.js';
import { potionForce } from './potion-force.js';
import { potionDeSoin } from './potion-de-soin.js';
import { chaines } from './chaines.js';
import { poisonMortel } from './poison-mortel.js';
import { rengoku } from './rengoku.js';
import { hopital } from './hopital.js';
import { confiscation } from './confiscation.js';
import { destruction } from './destruction.js';
import { regulationThermique } from './regulation-thermique.js';
import { bouclierUltime } from './bouclier-ultime.js';
import { autelDemoniaque } from './autel-demoniaque.js';

export {
  blitzcrank,
  caitlyn,
  guts,
  potionForce,
  potionDeSoin,
  chaines,
  poisonMortel,
  rengoku,
  hopital,
  confiscation,
  destruction,
  regulationThermique,
  bouclierUltime,
  autelDemoniaque,
};

let registered = false;

export function registerDemoCards(): void {
  if (registered) return;
  registered = true;

  registerCard(blitzcrank);
  registerCard(caitlyn);
  registerCard(guts);
  registerCard(potionForce);
  registerCard(potionDeSoin);
  registerCard(chaines);
  registerCard(poisonMortel);
  registerCard(rengoku);
  registerCard(hopital);
  registerCard(confiscation);
  registerCard(destruction);
  registerCard(regulationThermique);
  registerCard(bouclierUltime);
  registerCard(autelDemoniaque);
}

export const DEMO_ROSTER: RosterConfig = {
  characterCardIds: [blitzcrank.id, caitlyn.id, guts.id, rengoku.id],
  objectCardIds: [potionForce.id, potionDeSoin.id, chaines.id, poisonMortel.id],
  terrainCardIds: [
    hopital.id,
    confiscation.id,
    destruction.id,
    regulationThermique.id,
    bouclierUltime.id,
    autelDemoniaque.id,
  ],
};
