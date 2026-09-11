import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, any render-time exception (an unknown card id, a state shape the UI
 * didn't expect) unmounts the whole tree and leaves the player staring at a blank page
 * with no way back. Catching it keeps the app usable and shows what actually broke.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erreur d’interface :', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-panel">
          <span className="error-boundary-icon" aria-hidden="true">
            ⚠️
          </span>
          <h1 className="error-boundary-title">Une erreur est survenue</h1>
          <p className="error-boundary-text">
            L’interface a rencontré un problème inattendu. La partie en cours est conservée côté serveur : recharge la
            page pour la reprendre là où elle en était.
          </p>
          <div className="error-boundary-actions">
            <button className="primary" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
            <button onClick={() => window.location.assign('/')}>Retour à l’accueil</button>
          </div>
          {/* Le détail technique reste disponible (pour le signaler), mais replié : ce n'est
              pas ce que le joueur a besoin de lire en premier. */}
          <details className="error-boundary-details">
            <summary>Détail technique</summary>
            <pre className="error-details">{error.stack || error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
