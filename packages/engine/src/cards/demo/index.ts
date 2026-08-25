import type { RosterConfig } from '../../match.js';
import { registerCard } from '../registry.js';
import { aizen } from './aizen.js';
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
import { coeurAcier } from './coeur-acier.js';
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
import { voleurDeBouclier } from './voleur-de-bouclier.js';
import { sion } from './sion.js';
import { ornn } from './ornn.js';
import { absorptionVitale } from './absorption-vitale.js';
import { annulationDeTerritoire } from './annulation-de-territoire.js';
import { echangeEquivalent } from './echange-equivalent.js';
import { cameleon } from './cameleon.js';
import { soraka } from './soraka.js';
import { todo } from './todo.js';
import { gojoSatoru } from './gojo-satoru.js';
import { muzan } from './muzan.js';
import { mundo } from './mundo.js';
import { killua } from './killua.js';
import { chopper } from './chopper.js';
import { kakashi } from './kakashi.js';
import { mahito } from './mahito.js';
import { miroirDeRenvoi } from './miroir-de-renvoi.js';
import { adrenalineUltime } from './adrenaline-ultime.js';
import { kirigiri } from './kirigiri.js';
import { sukuna } from './sukuna.js';
import { bakugo } from './bakugo.js';
import { roiDesEsprits } from './roi-des-esprits.js';
import { locke } from './locke.js';
import { coupDeMain } from './coup-de-main.js';
import { chainsawMan } from './chainsaw-man.js';
import { pocheDeSang } from './poche-de-sang.js';
import { jacobEtEssau } from './jacob-et-essau.js';
import { pheonix } from './pheonix.js';
import { izukuDeLAcademie } from './izuku-de-l-academie.js';
import { blackPanther } from './black-panther.js';
import { attaqueClone } from './attaque-clone.js';
import { offrandeDuDieuDeLaMort } from './offrande-du-dieu-de-la-mort.js';

export {
  aizen,
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
  coeurAcier,
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
  voleurDeBouclier,
  sion,
  ornn,
  absorptionVitale,
  annulationDeTerritoire,
  echangeEquivalent,
  cameleon,
  soraka,
  todo,
  gojoSatoru,
  muzan,
  mundo,
  killua,
  chopper,
  kakashi,
  mahito,
  miroirDeRenvoi,
  adrenalineUltime,
  kirigiri,
  sukuna,
  bakugo,
  roiDesEsprits,
  locke,
  coupDeMain,
  chainsawMan,
  pocheDeSang,
  jacobEtEssau,
  pheonix,
  izukuDeLAcademie,
  blackPanther,
  attaqueClone,
  offrandeDuDieuDeLaMort,
};

let registered = false;

export function registerDemoCards(): void {
  if (registered) return;
  registered = true;

  registerCard(aizen);
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
  registerCard(coeurAcier);
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
  registerCard(voleurDeBouclier);
  registerCard(sion);
  registerCard(ornn);
  registerCard(absorptionVitale);
  registerCard(annulationDeTerritoire);
  registerCard(echangeEquivalent);
  registerCard(cameleon);
  registerCard(soraka);
  registerCard(todo);
  registerCard(gojoSatoru);
  registerCard(muzan);
  registerCard(mundo);
  registerCard(killua);
  registerCard(chopper);
  registerCard(kakashi);
  registerCard(mahito);
  registerCard(miroirDeRenvoi);
  registerCard(adrenalineUltime);
  registerCard(kirigiri);
  registerCard(sukuna);
  registerCard(bakugo);
  registerCard(roiDesEsprits);
  registerCard(locke);
  registerCard(coupDeMain);
  registerCard(chainsawMan);
  registerCard(pocheDeSang);
  registerCard(jacobEtEssau);
  registerCard(pheonix);
  registerCard(izukuDeLAcademie);
  registerCard(blackPanther);
  registerCard(attaqueClone);
  registerCard(offrandeDuDieuDeLaMort);
}

/**
 * A ready-to-play deck that fills every slot DECK_LIMITS allows : 6 personnages,
 * 8 objets, 3 terrains -- un exemplaire par personnage et par terrain (ils sont uniques),
 * jusqu'à deux par objet. Volontairement complet : c'est le deck que découvre un joueur
 * qui n'en a jamais composé, et un deck à moitié vide lui donne une partie à moitié
 * jouée. Le mélange couvre les grandes familles du moteur (soin, buff, contrôle, poison,
 * un objet à lier) pour que la démo montre de quoi le jeu est capable.
 *
 * DEMO_ROSTER below is the full *pool* of demo cards -- it is deliberately far bigger
 * than a legal deck, so it must never be handed to a player as their roster
 * (validateRoster rejects it, and the board only has 6 bench slots). Used as the
 * server-side fallback and as the web client's seeded deck.
 */
export const DEMO_STARTER_DECK: RosterConfig = {
  characterCardIds: [gojoSatoru.id, sukuna.id, guts.id, caitlyn.id, soraka.id, blitzcrank.id],
  objectCardIds: [
    potionDeSoin.id,
    potionDeSoin.id,
    potionForce.id,
    potionForce.id,
    determination.id,
    poisonMortel.id,
    chaines.id,
    miroirDeRenvoi.id,
  ],
  terrainCardIds: [hopital.id, protectionDivine.id, autelDemoniaque.id],
};

/** Every demo card, grouped by type -- a card *pool* to build decks from, not a legal deck. */
export const DEMO_ROSTER: RosterConfig = {
  characterCardIds: [
    aizen.id,
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
    todo.id,
    gojoSatoru.id,
    muzan.id,
    mundo.id,
    killua.id,
    chopper.id,
    kakashi.id,
    mahito.id,
    kirigiri.id,
    sukuna.id,
    bakugo.id,
    roiDesEsprits.id,
    locke.id,
    chainsawMan.id,
    izukuDeLAcademie.id,
    blackPanther.id,
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
    miroirDeRenvoi.id,
    adrenalineUltime.id,
    coupDeMain.id,
    pocheDeSang.id,
    jacobEtEssau.id,
    pheonix.id,
    attaqueClone.id,
    offrandeDuDieuDeLaMort.id,
  ],
  terrainCardIds: [
    hopital.id,
    confiscation.id,
    destruction.id,
    regulationThermique.id,
    bouclierUltime.id,
    coeurAcier.id,
    autelDemoniaque.id,
    pointFaible.id,
    protectionDivine.id,
    absorptionVitale.id,
  ],
};
