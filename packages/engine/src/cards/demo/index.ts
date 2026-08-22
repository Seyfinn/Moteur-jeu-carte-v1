import type { RosterConfig } from '../../match.js';
import { registerCard } from '../registry.js';
import { blitzcrank } from './blitzcrank.js';
import { caitlyn } from './caitlyn.js';
import { guts } from './guts.js';
import { hulk } from './hulk.js';
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
import { extensionDuTerritoire } from './extension-du-territoire.js';
import { poupeeVoodoo } from './poupee-voodoo.js';
import { determination } from './determination.js';
import { pointFaible } from './point-faible.js';
import { metamorphe } from './metamorphe.js';
import { concentration } from './concentration.js';
import { dechetterie } from './dechetterie.js';
import { couteauDansLeDos } from './couteau-dans-le-dos.js';
import { dieuDuTonnerreVolant } from './dieu-du-tonnerre-volant.js';
import { katarina } from './katarina.js';
import { akali } from './akali.js';
import { zoe } from './zoe.js';
import { protectionDivine } from './protection-divine.js';
import { briseBouclier } from './brise-bouclier.js';
import { voleurDeBouclier } from './voleur-de-bouclier.js';
import { sion } from './sion.js';
import { ornn } from './ornn.js';
import { absorptionVitale } from './absorption-vitale.js';
import { annulationDeTerritoire } from './annulation-de-territoire.js';
import { echangeEquivalent } from './echange-equivalent.js';
import { cameleon } from './cameleon.js';
import { soraka } from './soraka.js';

export {
  blitzcrank,
  caitlyn,
  guts,
  hulk,
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
  extensionDuTerritoire,
  poupeeVoodoo,
  determination,
  pointFaible,
  metamorphe,
  concentration,
  dechetterie,
  couteauDansLeDos,
  dieuDuTonnerreVolant,
  katarina,
  akali,
  zoe,
  protectionDivine,
  briseBouclier,
  voleurDeBouclier,
  sion,
  ornn,
  absorptionVitale,
  annulationDeTerritoire,
  echangeEquivalent,
  cameleon,
  soraka,
};

let registered = false;

export function registerDemoCards(): void {
  if (registered) return;
  registered = true;

  registerCard(blitzcrank);
  registerCard(caitlyn);
  registerCard(guts);
  registerCard(hulk);
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
  registerCard(extensionDuTerritoire);
  registerCard(poupeeVoodoo);
  registerCard(determination);
  registerCard(pointFaible);
  registerCard(metamorphe);
  registerCard(concentration);
  registerCard(dechetterie);
  registerCard(couteauDansLeDos);
  registerCard(dieuDuTonnerreVolant);
  registerCard(katarina);
  registerCard(akali);
  registerCard(zoe);
  registerCard(protectionDivine);
  registerCard(briseBouclier);
  registerCard(voleurDeBouclier);
  registerCard(sion);
  registerCard(ornn);
  registerCard(absorptionVitale);
  registerCard(annulationDeTerritoire);
  registerCard(echangeEquivalent);
  registerCard(cameleon);
  registerCard(soraka);
}

export const DEMO_ROSTER: RosterConfig = {
  characterCardIds: [
    blitzcrank.id,
    caitlyn.id,
    guts.id,
    rengoku.id,
    hulk.id,
    metamorphe.id,
    katarina.id,
    akali.id,
    zoe.id,
    sion.id,
    ornn.id,
    soraka.id,
  ],
  objectCardIds: [
    potionForce.id,
    potionDeSoin.id,
    chaines.id,
    poisonMortel.id,
    extensionDuTerritoire.id,
    poupeeVoodoo.id,
    determination.id,
    concentration.id,
    dechetterie.id,
    couteauDansLeDos.id,
    dieuDuTonnerreVolant.id,
    voleurDeBouclier.id,
    annulationDeTerritoire.id,
    echangeEquivalent.id,
    cameleon.id,
  ],
  terrainCardIds: [
    hopital.id,
    confiscation.id,
    destruction.id,
    regulationThermique.id,
    bouclierUltime.id,
    autelDemoniaque.id,
    pointFaible.id,
    protectionDivine.id,
    briseBouclier.id,
    absorptionVitale.id,
  ],
};
