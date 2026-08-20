import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerDemoCards } from 'engine';
import App from './App';
import './styles.css';

registerDemoCards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
