"use client";

import { useEffect, useRef, useState } from "react";

// Pacing for the in-progress answer. The model can write a whole answer in a second or two, which reads as a flash;
// these hooks reveal what has ALREADY ARRIVED at a readable pace (never ahead of the received text). They are used
// only for the live preview. Saved answers and History are rendered whole, and `prefers-reduced-motion` skips pacing.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const FRAME_MS = 33; // state updates at ~30 fps at most

// Reveals `target` progressively: faster when the backlog is large (never more than ~1.2 s behind the received text),
// at least ~120 characters per second, and fast once `finishing` (the validated answer has arrived). Reveals up to the
// next word boundary so Markdown and numbers don't flicker mid-word.
export function usePacedText(target: string, finishing: boolean): { text: string; drained: boolean } {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);
  const finishingRef = useRef(finishing);
  const pos = useRef(0);

  useEffect(() => {
    targetRef.current = target;
    finishingRef.current = finishing;
  }, [target, finishing]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSet = 0;
    const tick = (now: number) => {
      const t = targetRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (pos.current < t.length) {
        const backlog = t.length - pos.current;
        const cps = reducedMotion() ? Infinity : finishingRef.current ? Math.max(700, backlog / 0.25) : clamp(backlog / 1.2, 120, 500);
        pos.current = Math.min(t.length, pos.current + cps * dt);
      }
      let end = Math.floor(pos.current);
      if (end < t.length) {
        const m = /\s/.exec(t.slice(end, end + 12));
        if (m) end += m.index;
      }
      if (end !== lastSetValue.current && (now - lastSet >= FRAME_MS || end >= t.length)) {
        lastSet = now;
        lastSetValue.current = end;
        setShown(end);
      }
      raf = requestAnimationFrame(tick);
    };
    const lastSetValue = { current: -1 };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const end = Math.min(shown, target.length);
  return { text: target.slice(0, end), drained: end >= target.length };
}

// Reveals `total` items one at a time (table header, rows, sources, follow-ups): ~9 per second, much faster when
// `finishing`. Returns how many are visible. Items that arrive later extend `total` and keep the flow going.
export function usePacedCount(total: number, enabled: boolean, finishing: boolean): number {
  const [count, setCount] = useState(0);
  const ref = useRef({ total, enabled, finishing });

  useEffect(() => {
    ref.current = { total, enabled, finishing };
  }, [total, enabled, finishing]);

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const { total: n, enabled: on, finishing: fin } = ref.current;
      const now = performance.now();
      const gap = reducedMotion() ? 0 : fin ? 25 : 110;
      if (!on || now - last < gap) return;
      last = now;
      setCount((c) => (c < n ? c + 1 : c));
    }, 25);
    return () => clearInterval(id);
  }, []);

  return Math.min(count, total);
}
