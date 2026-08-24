import { getCharacterCard, getObjectCard, getTerrainCard, type CharacterInstance } from 'engine';
import { statusBadgeText } from './CharacterCard';

export function characterDetailBody(cardId: string, instance?: CharacterInstance) {
  const def = getCharacterCard(cardId);
  const currentHP = instance ? Math.max(0, instance.currentMaxHP - instance.damage) : undefined;
  // Même total que sur la carte : bouclier du moteur + réserves portées par un statut
  // (`data.shield`, cf. Mana Barrier de Blitzcrank).
  const shieldTotal = instance
    ? instance.shield + instance.statuses.reduce((sum, st) => sum + Math.max(0, Number(st.data?.['shield'] ?? 0)), 0)
    : 0;

  return (
    <>
      <div className="hover-card-hp">
        {instance ? (
          <>
            {currentHP} / {instance.currentMaxHP} HP
            {shieldTotal > 0 && <span className="shield-text"> +{shieldTotal} 🛡</span>}
          </>
        ) : (
          <>{def.baseMaxHP} HP</>
        )}
      </div>
      {instance && instance.statuses.some((s) => !s.hidden) && (
        <div className="statuses">
          {instance.statuses.filter((s) => !s.hidden).map((s, i) => (
            <span key={i} className="status-badge" title={`${s.label} (${s.statusId})`}>
              {statusBadgeText(s)}
            </span>
          ))}
        </div>
      )}

      {def.attacks.length > 0 && (
        <div className="hover-card-section">
          <h4>Attaques</h4>
          {def.attacks.map((a) => (
            <div key={a.id} className="hover-card-entry">
              <div className="hover-card-entry-head">
                <strong>{a.name}</strong>
                <span className="hover-card-tag">{a.baseATK} ATK</span>
              </div>
              <p>{a.description}</p>
            </div>
          ))}
        </div>
      )}

      {def.abilities.length > 0 && (
        <div className="hover-card-section">
          <h4>Abilities</h4>
          {def.abilities.map((a) => (
            <div key={a.id} className="hover-card-entry">
              <div className="hover-card-entry-head">
                <strong>{a.name}</strong>
                <span className="hover-card-tag">{a.kind === 'active' ? 'Active' : 'Passive'}</span>
              </div>
              <p>{a.description}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function objectDetailBody(cardId: string) {
  const def = getObjectCard(cardId);
  return <p>{def.description}</p>;
}

export function terrainDetailBody(cardId: string) {
  const def = getTerrainCard(cardId);
  return (
    <>
      <div className="hover-card-hp">{def.durationTurns !== undefined ? `Durée : ${def.durationTurns} tour${def.durationTurns > 1 ? 's' : ''}` : 'Durée : indéfinie'}</div>
      <p>{def.description}</p>
      {def.abilities && def.abilities.length > 0 && (
        <div className="hover-card-section">
          {def.abilities.map((a) => (
            <div key={a.id} className="hover-card-entry">
              <strong>{a.name}</strong>
              <p>{a.description}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function hiddenCardDetailBody() {
  return <p>Carte cachée -- son identité n'est révélée qu'une fois jouée.</p>;
}
