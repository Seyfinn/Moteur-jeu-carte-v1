import { getCharacterCard, getObjectCard, getTerrainCard, type CharacterInstance, type GameState } from 'engine';
import { statusBadgeText } from './CharacterCard';
import { toneForStatus } from './statusEffects';
import { attackReadouts, liveAttacks } from './boardActions';

/**
 * Jauge de PV de la fiche d'inspection. Même dégradé continu que sur le plateau (la teinte
 * est calculée ici et lue par la CSS), et le chiffre posé dessus plutôt qu'à côté : c'est
 * la première chose qu'on vient lire en ouvrant une fiche.
 */
function VitalsGauge({ current, max, shield }: { current: number; max: number; shield: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className={`ins-hp${shield > 0 ? ' shielded' : ''}`} style={{ ['--hp-hue' as string]: Math.round(pct * 1.2) }}>
      <div className="ins-hp-fill" style={{ width: `${pct}%` }} />
      <span className="ins-hp-text">
        {current} / {max}
        {shield > 0 && <em className="ins-hp-shield">+{shield} 🛡</em>}
      </span>
    </div>
  );
}

/**
 * Fiche d'un personnage. Avec `instance` + `state`, les ATK affichés sont ceux du moment
 * (dégâts évolutifs de Guts/Hulk/Mundo, buffs, malus) et non les valeurs imprimées : sans
 * `state` -- deck-builder, aperçu d'une carte hors jeu -- on retombe sur la carte nue.
 */
export function characterDetailBody(cardId: string, instance?: CharacterInstance, state?: GameState) {
  const def = getCharacterCard(cardId);
  const readouts = instance && state ? attackReadouts(state, instance) : [];
  // En jeu, la fiche liste ce que le personnage peut réellement déclarer : son attaque
  // empruntée ("Livre de Chrollo") en fait partie, ses propres attaques n'en font plus
  // partie tant que le prêt tient. Hors partie (deck-builder, aperçu), la carte nue.
  const attacks = instance && state ? liveAttacks(state, instance.instanceId) : def.attacks;
  const currentHP = instance ? Math.max(0, instance.currentMaxHP - instance.damage) : def.baseMaxHP;
  const maxHP = instance ? instance.currentMaxHP : def.baseMaxHP;
  // Même total que sur la carte : bouclier du moteur + réserves portées par un statut
  // (`data.shield`, cf. Mana Barrier de Blitzcrank).
  const shieldTotal = instance
    ? instance.shield + instance.statuses.reduce((sum, st) => sum + Math.max(0, Number(st.data?.['shield'] ?? 0)), 0)
    : 0;
  const statuses = instance ? instance.statuses.filter((s) => !s.hidden) : [];

  return (
    <>
      <VitalsGauge current={currentHP} max={maxHP} shield={shieldTotal} />

      {statuses.length > 0 && (
        <div className="ins-pills">
          {statuses.map((s, i) => (
            <span key={i} className={`ins-pill tone-${toneForStatus(s.statusId)}`} title={`${s.label} (${s.statusId})`}>
              {statusBadgeText(s)}
            </span>
          ))}
        </div>
      )}

      {attacks.length > 0 && (
        <section className="ins-block ins-block-attack">
          <h4>Attaques</h4>
          {attacks.map((a) => {
            const live = readouts.find((r) => r.id === a.id);
            const effective = live ? live.effective : a.baseATK;
            const shifted = live !== undefined && live.effective !== a.baseATK;
            return (
              <article key={a.id} className="ins-entry">
                <header className="ins-entry-head">
                  <span className="ins-entry-name">{a.name}</span>
                  <span className={`ins-badge ins-badge-atk${shifted ? (effective > a.baseATK ? ' up' : ' down') : ''}`}>
                    {effective} ATK
                  </span>
                </header>
                {/* La valeur imprimée n'apparaît que quand elle a été modifiée : une attaque
                    qui frappe pour ce qui est écrit dessus n'a rien à corriger. */}
                {shifted && <span className="ins-entry-note">imprimé {a.baseATK} ATK</span>}
                <p className="ins-entry-text">{a.description}</p>
              </article>
            );
          })}
        </section>
      )}

      {def.abilities.length > 0 && (
        <section className="ins-block ins-block-talent">
          <h4>Talents</h4>
          {def.abilities.map((a) => (
            <article key={a.id} className="ins-entry">
              <header className="ins-entry-head">
                <span className="ins-entry-name">{a.name}</span>
                <span className={`ins-badge ins-badge-${a.kind}`}>{a.kind === 'active' ? 'Actif' : 'Passif'}</span>
              </header>
              <p className="ins-entry-text">{a.description}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function objectDetailBody(cardId: string) {
  const def = getObjectCard(cardId);
  return (
    <>
      {def.equipment && (
        <div className="ins-pills">
          <span className="ins-pill tone-neutral">🔗 Objet à lier</span>
        </div>
      )}
      <p className="ins-entry-text">{def.description}</p>
    </>
  );
}

export function terrainDetailBody(cardId: string) {
  const def = getTerrainCard(cardId);
  return (
    <>
      <div className="ins-pills">
        <span className="ins-pill tone-freeze">
          ⏳{' '}
          {def.durationTurns !== undefined
            ? `${def.durationTurns} tour${def.durationTurns > 1 ? 's' : ''}`
            : 'Durée indéfinie'}
        </span>
      </div>
      <p className="ins-entry-text">{def.description}</p>
      {def.abilities && def.abilities.length > 0 && (
        <section className="ins-block ins-block-talent">
          <h4>Effets</h4>
          {def.abilities.map((a) => (
            <article key={a.id} className="ins-entry">
              <header className="ins-entry-head">
                <span className="ins-entry-name">{a.name}</span>
              </header>
              <p className="ins-entry-text">{a.description}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function hiddenCardDetailBody() {
  return <p className="ins-entry-text">Carte cachée -- son identité n'est révélée qu'une fois jouée.</p>;
}
