import { createRoot } from 'react-dom/client';
import { registerDemoCards } from 'engine';
import { HoverCardProvider } from '../components/HoverCard';
import Workshop from './EffectsWorkshop';

if (import.meta.env.DEV) {
  registerDemoCards();
  const root = createRoot(document.getElementById('root')!);
  root.render(<HoverCardProvider><Workshop /></HoverCardProvider>);
  import.meta.hot?.dispose(() => root.unmount());
}
