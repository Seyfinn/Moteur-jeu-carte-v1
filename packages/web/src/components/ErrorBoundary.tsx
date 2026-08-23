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
      <div className="lobby">
        <h1>Une erreur est survenue</h1>
        <p className="subtitle">
          L’interface a rencontré un problème inattendu. La partie en cours est conservée côté serveur : rechargez la
          page pour la reprendre.
        </p>
        <pre className="error-details">{error.message}</pre>
        <button className="primary" onClick={() => window.location.reload()}>
          Recharger
        </button>
      </div>
    );
  }
}
