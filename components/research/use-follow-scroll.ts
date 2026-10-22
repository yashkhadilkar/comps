"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

// Distance from the bottom of the page that still counts as "reading the latest content".
const NEAR_BOTTOM_PX = 150;

const distanceFromBottom = () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

// Keeps the page pinned to the newest research while `active` (a run is streaming or just finished), without fighting
// the reader: scrolling away from the bottom pauses following, scrolling back near the bottom resumes it. The page
// itself is the scroll container, so this listens to window scroll (passive) and a ResizeObserver on the content;
// there is no polling, and at most one scroll per animation frame. Returns `follow()` to re-pin on a new question.
export function useFollowScroll(contentRef: RefObject<HTMLElement | null>, active: boolean) {
  const pinned = useRef(false);
  const frame = useRef<number | null>(null);

  // Re-subscribes when `active` flips so the content element is found even if it mounts after the first render
  // (the home page swaps its empty state for the workspace on the first question).
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !active) return;

    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (distanceFromBottom() <= NEAR_BOTTOM_PX) pinned.current = true;
      else if (y < lastY) pinned.current = false; // only an upward scroll pauses; our own jump to the new question goes down
      lastY = y;
    };
    const scrollToBottom = () => {
      frame.current = null;
      if (pinned.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    };
    const observer = new ResizeObserver(() => {
      if (!pinned.current || frame.current !== null) return;
      frame.current = requestAnimationFrame(scrollToBottom);
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(el);
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [contentRef, active]);

  const follow = useCallback(() => {
    pinned.current = true;
  }, []);
  return follow;
}
