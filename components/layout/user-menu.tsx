"use client";

import { useEffect, useRef } from "react";
import { LogoutButton } from "@/components/logout-button";

export function UserMenu({ email }: { email: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const initial = (email ?? "?").trim().charAt(0).toUpperCase() || "?";

  // <details> does not close on outside click or Escape by itself.
  useEffect(() => {
    function close(e: Event) {
      const el = ref.current;
      if (!el?.open) return;
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && el.contains(e.target as Node)) return;
      el.open = false;
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Account menu"
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-line bg-subtle text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        {initial}
      </summary>
      <div className="absolute right-0 top-9 z-20 w-56 rounded-md border border-line bg-raised p-1.5">
        {email && <p className="truncate px-2.5 py-2 text-xs text-ink-3">{email}</p>}
        <LogoutButton />
      </div>
    </details>
  );
}
