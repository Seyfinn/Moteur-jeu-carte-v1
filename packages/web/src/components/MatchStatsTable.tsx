import { getCharacterCard, getCharacterStats, otherPlayer, type CharacterStats, type GameState, type PlayerId } from 'engine';

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

interface StatColumn {
  key: keyof CharacterStats;
  icon: string;
  label: string;
}

/**
 * Icônes plutôt que libellés en toutes lettres : huit colonnes + le nom ne tiennent pas
 * autrement dans une modale. Le `title` sur chaque `<th>` porte le libellé complet.
 */
const COLUMNS: StatColumn[] = [
  { key: 'damageDealt', icon: '⚔', label: 'Dégâts infligés' },
  { key: 'damageTaken', icon: '🛡', label: 'Dégâts reçus' },
  { key: 'healingDone', icon: '✚', label: 'Soins prodigués' },
  { key: 'shieldGained', icon: '🔷', label: 'Bouclier gagné' },
  { key: 'shieldBroken', icon: '🔻', label: 'Bouclier perdu' },
  { key: 'evasions', icon: '»', label: 'Esquives réussies' },
  { key: 'crits', icon: '◎', label: 'Coups critiques' },
  { key: 'kills', icon: '☠', label: 'Ennemis achevés' },
];

function emptyTotal(): CharacterStats {
  return { damageDealt: 0, damageTaken: 0, healingDone: 0, shieldGained: 0, shieldBroken: 0, evasions: 0, crits: 0, kills: 0 };
}

function sumStats(stats: CharacterStats[]): CharacterStats {
  const total = emptyTotal();
  for (const s of stats) {
    for (const col of COLUMNS) total[col.key] += s[col.key];
  }
  return total;
}

/** Un zéro se lit en retrait : l'œil va tout de suite aux colonnes qui ont compté. */
function StatCell({ value }: { value: number }) {
  return <td className={value === 0 ? 'match-stats-zero' : undefined}>{value}</td>;
}

function PlayerStatsTable({ state, playerId, heading }: { state: GameState; playerId: PlayerId; heading: string }) {
  const player = state.players[playerId];
  const characters = Object.values(player.characters);
  if (characters.length === 0) return null;
  const rows = characters.map((char) => ({ char, stats: getCharacterStats(state, char.instanceId) }));
  const total = sumStats(rows.map((r) => r.stats));

  return (
    <div className="match-stats-section">
      <h4 className="match-stats-heading">{heading}</h4>
      <div className="match-stats-scroll">
        <table className="match-stats-table">
          <thead>
            <tr>
              <th className="match-stats-name-col">Personnage</th>
              {COLUMNS.map((col) => (
                <th key={col.key} title={col.label} aria-label={col.label}>
                  {col.icon}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ char, stats }) => {
              const ko = player.graveyardCharacterInstanceIds.includes(char.instanceId);
              return (
                <tr key={char.instanceId} className={ko ? 'match-stats-row-ko' : undefined}>
                  <td className="match-stats-name-col">
                    {cardName(char.cardId)}
                    {ko && (
                      <span className="match-stats-ko-mark" title="Mis KO">
                        {' '}
                        ☠
                      </span>
                    )}
                  </td>
                  {COLUMNS.map((col) => (
                    <StatCell key={col.key} value={stats[col.key]} />
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="match-stats-name-col">Total</td>
              {COLUMNS.map((col) => (
                <StatCell key={col.key} value={total[col.key]} />
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Tableau de statistiques de fin de partie : une section par camp, une ligne par personnage. */
export function MatchStatsTable({ state, you }: { state: GameState; you: PlayerId }) {
  const opponentId = otherPlayer(you);
  const opponentName = state.players[opponentId].displayName || 'Adversaire';
  return (
    <div className="match-stats">
      <PlayerStatsTable state={state} playerId={you} heading="Vous" />
      <PlayerStatsTable state={state} playerId={opponentId} heading={opponentName} />
      {/* Les en-têtes ne sont que des icônes (huit colonnes + le nom ne tiennent pas
          autrement) : la légende, elle, se lit sans avoir à survoler chaque colonne. */}
      <ul className="match-stats-legend" aria-label="Légende des colonnes">
        {COLUMNS.map((col) => (
          <li key={col.key}>
            <span className="match-stats-legend-icon" aria-hidden="true">
              {col.icon}
            </span>
            {col.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
