import { useLayoutEffect, useRef } from 'react';

type Position = { rect: DOMRect; zone: string };
type Flight = { ghost: HTMLElement; card: HTMLElement; animation: Animation };

/** Shared by the board and the visual workshop. Track identity across React remounts:
 * an active card and its bench thumbnail are different DOM elements. */
export function useBoardMotion(disabled = false) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, Position>());
  const flights = useRef(new Map<string, Flight>());

  const finish = (id: string) => {
    const flight = flights.current.get(id);
    if (!flight) return;
    flight.animation.cancel();
    flight.ghost.remove();
    flight.card.style.removeProperty('visibility');
    flights.current.delete(id);
  };

  useLayoutEffect(() => {
    const next = new Map<string, Position>();
    const reduced = disabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.current?.querySelectorAll<HTMLElement>('[data-board-character]').forEach(card => {
      const id = card.dataset.boardCharacter!;
      const zone = card.dataset.boardZone!;
      const rect = card.getBoundingClientRect();
      const before = previous.current.get(id);
      next.set(id, { rect, zone });
      if (!before || before.zone === zone || !rect.width || !before.rect.width || reduced) return;

      // An interrupted switch starts where the previous flight is actually visible.
      const from = flights.current.get(id)?.ghost.getBoundingClientRect() ?? before.rect;
      finish(id);
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.className = `${card.className} card-motion-ghost`;
      ghost.removeAttribute('data-board-character');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      Object.assign(ghost.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
        visibility: 'visible', transformOrigin: '0 0',
      });
      document.body.appendChild(ghost);
      card.style.visibility = 'hidden';
      const dx = from.left - rect.left;
      const dy = from.top - rect.top;
      const sx = from.width / rect.width;
      const sy = from.height / rect.height;
      const transform = (x: number, y: number, xScale: number, yScale: number) =>
        `translate(${x}px, ${y}px) scale(${xScale}, ${yScale})`;
      const animation = ghost.animate([
        { transform: transform(dx, dy, sx, sy), offset: 0 },
        { transform: transform(dx * .5, dy * .5 - 28, (sx + 1) / 2, (sy + 1) / 2), offset: .45 },
        { transform: transform(0, -4, 1.015, 1.015), offset: .82 },
        { transform: transform(0, 0, 1, 1), offset: 1 },
      ], { duration: 560, easing: 'cubic-bezier(.22,.75,.25,1)', fill: 'both' });
      flights.current.set(id, { ghost, card, animation });
      animation.onfinish = () => {
        if (flights.current.get(id)?.animation === animation) finish(id);
      };
    });
    for (const id of flights.current.keys()) {
      if (reduced || !next.has(id)) finish(id);
    }
    previous.current = next;
  });

  useLayoutEffect(() => {
    const cancel = () => { for (const id of flights.current.keys()) finish(id); };
    const reposition = () => {
      cancel();
      root.current?.querySelectorAll<HTMLElement>('[data-board-character]').forEach(card => {
        previous.current.set(card.dataset.boardCharacter!, {
          rect: card.getBoundingClientRect(), zone: card.dataset.boardZone!,
        });
      });
    };
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    preference.addEventListener('change', cancel);
    return () => {
      cancel();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      preference.removeEventListener('change', cancel);
    };
  }, []);
  return root;
}
