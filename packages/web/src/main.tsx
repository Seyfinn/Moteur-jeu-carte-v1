import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerDemoCards } from 'engine';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

registerDemoCards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
