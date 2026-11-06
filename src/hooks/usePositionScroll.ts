import { useLayoutEffect, useRef } from 'react';

/** Keep a reading position when a move temporarily removes analysis content. */
export function usePositionScroll(positionId: string, layoutKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const previousLayoutRef = useRef(layoutKey);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    if (previousLayoutRef.current !== layoutKey) {
      // Explicit section/tab changes and new games may legitimately shrink it.
      previousLayoutRef.current = layoutKey;
      content.style.minHeight = '';
      offsetRef.current = scroller.scrollTop;
      return;
    }
    const offset = offsetRef.current;
    if (offset > 0) {
      // The new position has no candidates yet. Reserve only enough room to
      // retain the viewport, without showing the previous position's moves.
      content.style.minHeight = `${offset + scroller.clientHeight}px`;
      scroller.scrollTop = offset;
    }
  }, [layoutKey, positionId]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const onScroll = () => {
      offsetRef.current = scroller.scrollTop;
      if (content.style.minHeight) {
        // Release reserved space as the reader scrolls back up.
        content.style.minHeight = offsetRef.current > 0
          ? `${offsetRef.current + scroller.clientHeight}px`
          : '';
      }
    };
    const onResize = () => {
      content.style.minHeight = '';
      offsetRef.current = scroller.scrollTop;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return { scrollRef, contentRef };
}
