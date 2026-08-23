import { useEffect, useState } from 'react';

const QUERY = '(hover: none), (pointer: coarse)';

/** True on touch-primary devices (phones/tablets) where CSS :hover doesn't reflect a real
    hover intent -- used to swap hover-triggered card previews for tap-triggered ones.
    Re-evaluated live (e.g. a tablet docked to a mouse). */
export function usePointerCoarse(): boolean {
  const [coarse, setCoarse] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return coarse;
}
