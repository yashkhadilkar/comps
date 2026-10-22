"use client";

import { useHydrated } from "./use-hydrated";

// "Asked Oct 19, 2026 · 10:28 PM" in the viewer's time zone.
export function SavedTime({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useHydrated();
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  const text =
    hydrated && valid
      ? `Asked ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : "Asked earlier";
  return (
    <time dateTime={valid ? iso : undefined} className={className}>
      {text}
    </time>
  );
}
