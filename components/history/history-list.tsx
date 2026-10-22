"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRightIcon } from "@/components/ui/icons";
import { groupByDay, type ThreadRow } from "@/lib/history-parse";
import { useHydrated } from "./use-hydrated";

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dateOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Rows are grouped Today / Yesterday / Earlier by the viewer's local day, so this renders after hydration.
export function HistoryList({ rows }: { rows: ThreadRow[] }) {
  const hydrated = useHydrated();
  const groups = useMemo(() => (hydrated ? groupByDay(rows, new Date(), (r) => r.updatedAt) : []), [hydrated, rows]);

  if (!hydrated) return <div aria-busy="true" className="min-h-40" />;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2 className="border-b border-line-subtle pb-2 text-xs font-medium uppercase tracking-wider text-ink-3">
            {group.label}
          </h2>
          <ul>
            {group.rows.map((row) => (
              <li key={row.id} className="border-b border-line-subtle last:border-0">
                <Link
                  href={`/history/${row.id}`}
                  className="group -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3.5 transition-colors duration-150 hover:bg-subtle"
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{row.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      <span className="text-ink-2">{row.runCount === 1 ? "1 question" : `${row.runCount} questions`}</span>
                      <span className="mx-1.5 text-ink-4">·</span>
                      {group.label === "Earlier" ? `${dateOf(row.updatedAt)}, ` : ""}
                      {timeOf(row.updatedAt)}
                    </span>
                  </span>
                  <ArrowRightIcon
                    size={14}
                    className="shrink-0 text-ink-4 transition-colors duration-150 group-hover:text-ink-2"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
