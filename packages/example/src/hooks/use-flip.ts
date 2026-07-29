import { type RefObject, useLayoutEffect, useRef } from 'react';

const EASE_OUT_QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const DURATION_MS = 380;

/**
 * Animate a grid's children between layouts, rather than letting them jump.
 *
 * FLIP: read where each child was, let React reorder the DOM, read where each
 * child is now, then play the difference as a transform back to the old
 * position and forward to the new one. CSS transitions cannot do this on their
 * own — a grid item's position is set by the layout, and layout changes are not
 * transitionable.
 *
 * Positions are read as `offsetLeft`/`offsetTop`, NOT `getBoundingClientRect`.
 * The effect only runs when the order changes, so the recorded positions may be
 * several renders old, and rect coordinates are viewport-relative: any scrolling
 * in between would be measured as movement and every card would animate from
 * nowhere. Offsets are relative to the offset parent, so scrolling does not
 * affect them.
 *
 * @param containerRef
 * The element whose direct children are animated. Each child must carry a
 * `data-flip-id`.
 * @param order
 * The current order. Identity, not contents, is the trigger — the search state
 * reuses the same array while a run is in flight and only builds a new one when
 * the grid actually re-settles.
 */
export function useFlip(
  containerRef: RefObject<HTMLElement | null>,
  order: string[],
) {
  const previous = useRef<Map<string, { left: number; top: number }>>(
    new Map(),
  );

  // `order` is not read inside the effect, so Biome sees it as an unnecessary
  // dependency. It is the entire point: the effect must re-run exactly when the
  // grid re-orders, and the search state signals that by building a new array
  // only at that moment. Reading positions on every render instead would mean
  // 56 layout-forcing reads per result, 56 times per search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `order` is the intended trigger, by identity
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const children = Array.from(container.children) as HTMLElement[];
    const next = new Map<string, { left: number; top: number }>();
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    for (const child of children) {
      // `dataset` is an index signature, and the repository's shared tsconfig
      // sets `noPropertyAccessFromIndexSignature` — dot access is TS4111 here.
      // biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
      const id = child.dataset['flipId'];
      if (!id) continue;

      const position = { left: child.offsetLeft, top: child.offsetTop };
      next.set(id, position);

      if (reducedMotion) continue;

      const old = previous.current.get(id);
      if (!old) continue;

      const dx = old.left - position.left;
      const dy = old.top - position.top;
      if (dx === 0 && dy === 0) continue;

      child.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: DURATION_MS, easing: EASE_OUT_QUINT },
      );
    }

    previous.current = next;
  }, [containerRef, order]);
}
