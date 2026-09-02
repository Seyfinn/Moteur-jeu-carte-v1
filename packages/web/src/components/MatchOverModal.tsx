import { otherPlayer, type GameState, type PlayerId } from 'engine';
import type { GameConnection } from '../net/useGameConnection';
import { MatchStatsTable } from './MatchStatsTable';

/**
 * Fin de partie. Posée par-dessus le plateau plutôt qu'à sa place : le dernier état de la
 * table (qui restait debout, avec combien de PV) est justement ce qu'on veut regarder en
 * lisant le verdict.
 *
 * Deux sorties, et une seule d'entre elles quitte le salon :
 * - « Rejouer » demande une revanche au serveur. Il en faut une de chaque camp, donc le
 *   bouton reste affiché en attente tant que l'adversaire n'a pas répondu ; quand les deux
 *   l'ont demandée, une nouvelle partie est diffusée et cette modale disparaît d'elle-même.
 * - « Retour au salon » ferme la connexion et renvoie à l'écran d'accueil.
 */
export function MatchOverModal({ state, you, conn }: { state: GameState; you: PlayerId; conn: GameConnection }) {
  const result = state.result;
  if (!result) return null;

  const opponentId = otherPlayer(you);
  const opponentName = state.players[opponentId].displayName || 'Adversaire';
  const draw = result.kind === 'draw';
  const won = result.kind === 'win' && result.winner === you;
  // Une victoire par abandon se lit autrement qu'une victoire au plateau : sans le dire,
  // le gagnant voit « Victoire » sans comprendre pourquoi la partie s'est arrêtée net.
  const forfeited = result.kind === 'win' && result.reason === 'forfeit';

  const outcome = draw ? 'draw' : won ? 'win' : 'loss';
  const title = draw ? 'Égalité' : won ? 'Victoire !' : 'Défaite';
  const subtitle = draw
    ? 'Les deux camps tombent en même temps.'
    : won
      ? forfeited
        ? `${opponentName} a abandonné.`
        : `${opponentName} n'a plus personne debout.`
      : forfeited
        ? 'Vous avez abandonné la partie.'
        : 'Tous vos personnages sont au tapis.';

  const youAsked = conn.rematchVotes.includes(you);
  const theyAsked = conn.rematchVotes.includes(opponentId);
  const rematchNote = conn.opponentDisconnected
    ? "L'adversaire s'est déconnecté : la revanche attendra son retour."
    : youAsked
      ? "En attente de l'adversaire…"
      : theyAsked
        ? `${opponentName} veut rejouer !`
        : null;

  return (
    // Panneau imbriqué dans le voile, et non posé à côté : c'est le voile qui centre
    // (`.modal-backdrop` est un flex centré), donc l'animation d'entrée est libre de
    // piloter `transform` sans avoir à recomposer un centrage à la main.
    <div className="modal-backdrop match-over-backdrop">
      <div className={`match-over match-over-${outcome}`} role="dialog" aria-label="Fin de partie">
        <span className="match-over-icon" aria-hidden="true">
          {draw ? '🤝' : won ? '🏆' : '💀'}
        </span>
        <h2 className="match-over-title">{title}</h2>
        <p className="match-over-subtitle">{subtitle}</p>

        <div className="match-over-actions">
          <button className="primary" onClick={conn.requestRematch} disabled={youAsked}>
            {youAsked ? '⏳ Revanche demandée' : '🔄 Rejouer'}
          </button>
          <button onClick={conn.leave} title="Quitter la partie et revenir à l'écran d'accueil">
            🚪 Retour au salon
          </button>
        </div>

        {rematchNote && (
          <p className={`match-over-note${theyAsked && !youAsked ? ' urgent' : ''}`} aria-live="polite">
            {rematchNote}
          </p>
        )}

        <MatchStatsTable state={state} you={you} />
      </div>
    </div>
  );
}
