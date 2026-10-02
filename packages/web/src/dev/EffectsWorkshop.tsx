/** Development-only visual workbench. Not part of index.html / the production bundle. */
import { useLayoutEffect, useState } from 'react';
import { getCharacterCard, type CharacterInstance } from 'engine';
import { CharacterCard } from '../components/CharacterCard';
import { CardFrame } from '../components/CardFrame';
import { StatusEffectLayers } from '../components/statusEffects';
import { CardFlourishes, StrikeBolts } from '../components/BoardFx';
import { CardSpotlights } from '../components/CardSpotlight';
import { ProcWheels } from '../components/ProcWheel';
import { KoFlights } from '../components/KoFlight';
import { useBoardMotion } from '../components/useBoardMotion';
import { HIT_CONTACT_MS, type CardFlourish, type CardSpotlight, type CharacterImpact, type ProcRoll, type StrikeBolt, type KoFlight } from '../components/gameEvents';
import '../styles.css';
import '../combatEffects.css';
import './effects.css';

function character(instanceId: string, cardId: string): CharacterInstance {
  const hp = getCharacterCard(cardId).baseMaxHP;
  return { instanceId, cardId, ownerId: 'p1', baseMaxHP: hp, currentMaxHP: hp, damage: 40, shield: 0, statuses: [], attachedObjectInstanceIds: [], abilityUsesThisTurn: {}, abilityUsesThisGame: {} };
}
const STATUSES = [
  ['poison', 'Poison'], ['burn', 'Brûlure'], ['bleed', 'Saignement'], ['stun', 'Étourdissement'],
  ['chained', 'Chaînes'], ['atk-boost', 'Force'], ['atk-reduction', 'Affaiblissement'], ['evasive', 'Esquive'],
  ['critical', 'Critique'], ['silence-active', 'Silence'], ['disarmed', 'Désarmement'], ['death-ward', 'Protection'],
  ['vulnerable', 'Vulnérabilité'], ['unhealable', 'Marque'], ['linked', 'Lien'], ['blitzcrank-hook-locked', 'Verrou'],
  ['hit-bounty', 'Prime'], ['custom', 'Effet spécial'],
] as const;

export default function Workshop() {
  const [target, setTarget] = useState(() => character('preview-target', 'kayn'));
  const [attacker, setAttacker] = useState(() => character('preview-attacker', 'gon'));
  const [reserve, setReserve] = useState(() => character('preview-reserve', 'killua'));
  const [scene, setScene] = useState<{ id: number; name: string }>({ id: 0, name: '' });
  const [freeze, setFreeze] = useState(false);
  const [time, setTime] = useState(320);
  const [reducedCss, setReducedCss] = useState('');
  const motionRoot = useBoardMotion(Boolean(reducedCss));
  const [impact, setImpact] = useState<CharacterImpact>();
  const [flourishes, setFlourishes] = useState<CardFlourish[]>([]);
  const [bolts, setBolts] = useState<StrikeBolt[]>([]);
  const [spotlights, setSpotlights] = useState<CardSpotlight[]>([]);
  const [rolls, setRolls] = useState<ProcRoll[]>([]);
  const [flights, setFlights] = useState<KoFlight[]>([]);
  function play(name: string) {
    const id = scene.id + 1;
    setScene({ id, name }); setFlourishes([]); setBolts([]); setSpotlights([]); setRolls([]); setFlights([]); setImpact(undefined);
    const characterInstanceId = target.instanceId;
    if (name === 'Frappe' || name === 'Critique' || name === 'Cataclysme') {
      const critical = name === 'Critique';
      const tier = name === 'Cataclysme' ? 'cataclysm' : 'heavy';
      setImpact({ id, role: 'target', tier, critical, otherInstanceId: attacker.instanceId });
      setBolts([{ id, fromInstanceId: attacker.instanceId, toInstanceId: characterInstanceId, tier, critical }]);
      setFlourishes([{ id, characterInstanceId, kind: critical ? 'crit' : 'impact', tier, delayMs: HIT_CONTACT_MS }]);
      setTarget(t => ({ ...t, damage: t.damage > 110 ? 40 : t.damage + 25 }));
    } else if (name === 'Déplacement') { setAttacker(reserve); setReserve(attacker); }
    else if (name === 'Soin') setTarget(t => ({ ...t, damage: t.damage > 0 ? Math.max(0, t.damage - 25) : 60 }));
    else if (name === 'Bouclier') { setTarget(t => ({ ...t, shield: t.shield ? 0 : 40 })); setFlourishes([{ id, characterInstanceId, kind: 'shield-hit' }]); }
    else if (name === 'Esquive' || name === 'Verrou' || name === 'Résurrection') setFlourishes([{ id, characterInstanceId, kind: name === 'Esquive' ? 'evasion' : name === 'Verrou' ? 'lock' : 'revive' }]);
    else if (name === 'Statut') setFlourishes([{ id, characterInstanceId, kind: 'status', color: '#b07ede' }]);
    else if (name === 'KO') setFlights([{ id, instanceId: characterInstanceId, cardId: target.cardId, ownerId: 'p1' }]);
    else if (name === 'Gon' || name === 'Kayn' || name === 'Rhaast') setFlourishes([{ id, characterInstanceId, kind: 'evolve', variant: name === 'Gon' ? 'gon-adulte' : name === 'Kayn' ? 'kayn-assassin' : 'rhaast' }]);
    else if (name === 'Chance' || name === 'Échec') setRolls([{ id, kind: 'chance', percent: 33, hit: name === 'Chance', characterName: 'Kayn', cardId: 'kayn', label: 'Transformation' }]);
    else {
      const cardKind = name === 'Objet' ? 'object' : name === 'Terrain' ? 'terrain' : 'character';
      setSpotlights([{ id, cardId: cardKind === 'object' ? 'potion-force' : cardKind === 'terrain' ? 'arene' : 'gon', cardKind, name, action: name, detail: cardKind === 'character' ? 'Serment de Vengeance' : undefined }]);
    }
  }
  useLayoutEffect(() => {
    // Scrubbing uses browser animation objects, leaving the production components intact.
    const frame = requestAnimationFrame(() => {
      for (const animation of document.getAnimations()) {
        if (freeze) { animation.pause(); animation.currentTime = time; }
        else if (animation.playState === 'paused') animation.play();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scene, freeze, time, target]);
  return <main className="effects-workshop">
    {reducedCss && <style>{reducedCss}</style>}
    <header><div><span className="workshop-eyebrow">DIRECTION VISUELLE · COMBAT</span><h1>Atelier des effets</h1><p>Les animations du jeu, à rejouer et à examiner librement.</p></div><a href="/">Retour au jeu ↗</a></header>
    <section className="workshop-stage" ref={motionRoot}>
      <div className="workshop-duel">
        <CharacterCard key={attacker.instanceId} char={attacker} isActive size="large" facing="right" motionZone="active" impact={impact ? { ...impact, role: 'attacker', otherInstanceId: target.instanceId } : undefined} />
        <div className="workshop-vs">VS<span>{scene.name || 'Choisir un effet'}</span></div>
        <CharacterCard char={target} isActive size="large" impact={impact} motionZone="opponent" />
      </div>
      <div className="workshop-bench"><CharacterCard key={reserve.instanceId} char={reserve} isActive={false} size="small" motionZone="bench" /><span>Banc · déplacement vers le combat</span></div>
      <StrikeBolts bolts={bolts} /><CardFlourishes flourishes={flourishes} /><CardSpotlights spotlights={spotlights} /><ProcWheels rolls={rolls} /><KoFlights flights={flights} />
      <div className="workshop-controls">{['Frappe','Critique','Cataclysme','Déplacement','Soin','Bouclier','Esquive','Verrou','Statut','Résurrection','KO','Gon','Kayn','Rhaast','Capacité','Objet','Terrain','Chance','Échec'].map(name => <button key={name} aria-pressed={scene.name === name} onClick={() => play(name)}>{name}</button>)}</div>
      <div className="workshop-timeline"><label><input type="checkbox" checked={freeze} onChange={e => setFreeze(e.target.checked)} /> Arrêt sur image</label><input aria-label="Instant de l’animation" type="range" min="0" max="3000" step="10" value={time} onChange={e => { setFreeze(true); setTime(Number(e.target.value)); }} /><output>{time} ms</output></div>
      <div className="workshop-timeline"><label><input type="checkbox" checked={Boolean(reducedCss)} onChange={e => {
        // Apply the real media-rule bodies locally without changing OS preferences.
        setReducedCss(e.target.checked ? Array.from(document.styleSheets).flatMap(sheet => {
          try { return Array.from(sheet.cssRules).filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(prefers-reduced-motion: reduce)').map(rule => Array.from(rule.cssRules).map(child => child.cssText).join('\n')); }
          catch { return []; }
        }).join('\n') : '');
      }} /> Simuler le mouvement réduit</label></div>
    </section>
    <h2>Les signatures de statut</h2><p>Une couleur, une forme et un mouvement pour chaque famille.</p>
    <section className="workshop-statuses">{STATUSES.map(([statusId, name]) => <article key={statusId}><CardFrame cardId="kayn" kind="character" name={name} effects={<StatusEffectLayers statuses={[{ statusId, data: { stacks: 3 } }]} />} /><h3>{name}</h3></article>)}</section>
  </main>;
}
