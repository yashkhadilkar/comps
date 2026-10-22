"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HistoryIcon, PlusIcon, ScaleIcon, SidebarIcon, TagIcon } from "@/components/ui/icons";
import type { ThreadRow } from "@/lib/history-parse";
import { NEW_QUESTION_EVENT, THREAD_ACTIVITY_EVENT, type ThreadActivity } from "./events";

const itemClass = (active: boolean) =>
  `flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150 ${
    active ? "bg-hover text-accent" : "text-ink-3 hover:bg-subtle hover:text-ink"
  }`;

function useNav() {
  const pathname = usePathname();
  const router = useRouter();
  function newQuestion() {
    if (pathname === "/") window.dispatchEvent(new Event(NEW_QUESTION_EVENT));
    else router.push("/");
  }
  return { pathname, newQuestion };
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Comps home"
      className={`flex h-9 w-9 items-center justify-center rounded-md border border-line bg-raised text-[15px] font-semibold text-ink ${className}`}
    >
      C
    </Link>
  );
}

// Expanded (icons + labels) by default; the toggle collapses it to the icon rail. The choice is remembered per browser.
const COLLAPSE_KEY = "comps:sidebar-collapsed";
const storageKey = (userId?: string | null) => `${COLLAPSE_KEY}:${userId ?? "anon"}`;
const COLLAPSE_EVENT = "comps:sidebar-toggle";

function readCollapsed(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(cb: () => void) {
  window.addEventListener(COLLAPSE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// Remembered per account, so a new account on the same browser starts expanded.
function useCollapsed(userId?: string | null) {
  const key = storageKey(userId);
  const collapsed = useSyncExternalStore(subscribeCollapsed, () => readCollapsed(key), () => false);
  const toggle = () => {
    try {
      localStorage.setItem(key, collapsed ? "0" : "1");
    } catch {
      // Storage blocked: the toggle just won't persist.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };
  return { collapsed, toggle };
}

const rowClass = (active: boolean, collapsed: boolean) =>
  `flex h-10 items-center rounded-md text-[14px] font-medium transition-colors duration-150 ${
    collapsed ? "w-10 justify-center" : "w-full gap-3 px-3"
  } ${active ? "bg-hover text-accent" : "text-ink-3 hover:bg-hover/60 hover:text-ink"}`;

export type RecentThreads = { ok: true; rows: ThreadRow[] } | { ok: false } | null;

// "Recent research": the user's latest threads (server-loaded, RLS-scoped) plus any thread touched in this session,
// which is shown first right away. A touched thread replaces its server row, so nothing appears twice.
function RecentList({ recent, pathname }: { recent: RecentThreads; pathname: string }) {
  const [touched, setTouched] = useState<ThreadActivity[]>([]);

  useEffect(() => {
    const onActivity = (e: Event) => {
      const t = (e as CustomEvent<ThreadActivity>).detail;
      if (t?.id) setTouched((prev) => [t, ...prev.filter((p) => p.id !== t.id)]);
    };
    window.addEventListener(THREAD_ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(THREAD_ACTIVITY_EVENT, onActivity);
  }, []);

  const items = useMemo(() => {
    const server = recent && recent.ok ? recent.rows : [];
    const ids = new Set(touched.map((t) => t.id));
    return [...touched.map((t) => ({ id: t.id, title: t.title })), ...server.filter((r) => !ids.has(r.id))];
  }, [recent, touched]);

  if (!recent) return null;
  return (
    <section aria-label="Recent research" className="mt-4 flex min-h-0 flex-1 flex-col">
      <h2 className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-4">Recent research</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!recent.ok && items.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-ink-4">Couldn&rsquo;t load recent research.</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-ink-4">No research yet.</p>
        ) : (
          <ul>
            {items.map((t) => {
              const active = pathname === `/history/${t.id}`;
              return (
                <li key={t.id}>
                  <Link
                    href={`/history/${t.id}`}
                    title={t.title}
                    aria-current={active ? "page" : undefined}
                    className={`block truncate rounded-md px-3 py-1.5 text-[13px] leading-5 transition-colors duration-150 ${
                      active ? "bg-hover text-ink" : "text-ink-3 hover:bg-hover/60 hover:text-ink"
                    }`}
                  >
                    {t.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link
        href="/history"
        className="mt-1 block px-3 py-1.5 text-xs text-ink-4 transition-colors duration-150 hover:text-ink-2"
      >
        View all history
      </Link>
    </section>
  );
}

// Desktop sidebar. Only real destinations: no placeholders.
export function Sidebar({ userId, recent = null }: { userId?: string | null; recent?: RecentThreads }) {
  const { pathname, newQuestion } = useNav();
  const { collapsed, toggle } = useCollapsed(userId);
  const items = [
    { href: "/history", label: "History", icon: <HistoryIcon size={18} /> },
    { href: "/audit", label: "Comparability Audit", icon: <ScaleIcon size={18} /> },
    { href: "/pricing", label: "Pricing", icon: <TagIcon size={18} /> },
  ];
  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 border-r border-line-subtle bg-sidebar py-3 md:flex ${
        collapsed ? "w-(--sidebar-width) items-center" : "w-(--sidebar-width-open) px-3"
      }`}
    >
      <div className={`mb-3 flex ${collapsed ? "flex-col items-center gap-2" : "items-center justify-between"}`}>
        <Logo />
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-hover/60 hover:text-ink"
        >
          <SidebarIcon size={18} />
        </button>
      </div>
      <nav aria-label="Primary" className={`flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
        <button
          type="button"
          onClick={newQuestion}
          className={rowClass(pathname === "/", collapsed)}
          aria-label="New question"
          title="New question"
        >
          <PlusIcon size={18} className="shrink-0" />
          {!collapsed && "New question"}
        </button>
        {items.map((item) => {
          const active = item.href === "/history" ? pathname === "/history" : pathname.startsWith(item.href); // a thread highlights itself in Recent research
          return (
            <Link
              key={item.href}
              href={item.href}
              className={rowClass(active, collapsed)}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      {!collapsed && <RecentList recent={recent} pathname={pathname} />}
    </aside>
  );
}

// The rail becomes a compact row in the top bar below the md breakpoint.
export function MobileNav() {
  const { pathname, newQuestion } = useNav();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 md:hidden">
      <Logo className="mr-1" />
      <button
        type="button"
        onClick={newQuestion}
        className={`${itemClass(pathname === "/")} h-9 w-9`}
        aria-label="New question"
      >
        <PlusIcon size={18} />
      </button>
      <Link
        href="/history"
        className={`${itemClass(pathname.startsWith("/history"))} h-9 w-9`}
        aria-label="History"
        aria-current={pathname.startsWith("/history") ? "page" : undefined}
      >
        <HistoryIcon size={18} />
      </Link>
      <Link
        href="/audit"
        className={`${itemClass(pathname.startsWith("/audit"))} h-9 w-9`}
        aria-label="Comparability Audit"
        aria-current={pathname.startsWith("/audit") ? "page" : undefined}
      >
        <ScaleIcon size={18} />
      </Link>
      <Link
        href="/pricing"
        className={`${itemClass(pathname.startsWith("/pricing"))} h-9 w-9`}
        aria-label="Pricing"
        aria-current={pathname.startsWith("/pricing") ? "page" : undefined}
      >
        <TagIcon size={18} />
      </Link>
    </nav>
  );
}
