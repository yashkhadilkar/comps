"use client";

import { CheckIcon, ChevronRightIcon, SpinnerIcon, XIcon } from "@/components/ui/icons";
import type { TraceStep } from "@/lib/agent/types";

type Row =
  | { kind: "thought"; text: string }
  | { kind: "info"; text: string }
  | { kind: "action"; id: string; label: string; done: boolean; ok: boolean; summary: string };

function toRows(steps: TraceStep[]): Row[] {
  const observations = new Map<string, Extract<TraceStep, { type: "observation" }>>();
  for (const s of steps) if (s.type === "observation") observations.set(s.id, s);

  const rows: Row[] = [];
  for (const s of steps) {
    if (s.type === "thought") rows.push({ kind: "thought", text: s.text });
    else if (s.type === "info") rows.push({ kind: "info", text: s.text });
    else if (s.type === "action") {
      const obs = observations.get(s.id);
      rows.push({
        kind: "action",
        id: s.id,
        label: s.label,
        done: !!obs,
        ok: obs?.ok ?? false,
        summary: obs?.summary ?? "",
      });
    }
  }
  return rows;
}

// Live research progress while running; collapses to "Researched in N steps" (N = tool calls listed) once the answer arrives.
export function AgentTrace({ steps, loading }: { steps: TraceStep[]; loading: boolean }) {
  if (!steps.length && !loading) return null;
  const rows = toRows(steps);
  // A "step" is one visible tool call (one action row below), so the count always matches the list.
  const stepCount = rows.filter((r) => r.kind === "action").length;

  return (
    <details open={loading} className="group mt-8 border-y border-line-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon size={14} className="text-ink-3 transition-transform duration-150 group-open:rotate-90" />
        {loading ? (
          <span className="flex items-center gap-2">
            Researching{stepCount > 0 ? ` · ${stepCount} step${stepCount === 1 ? "" : "s"} so far` : ""}
            <SpinnerIcon size={13} className="text-ink-3" />
          </span>
        ) : (
          `Researched in ${stepCount} step${stepCount === 1 ? "" : "s"}`
        )}
      </summary>
      <ol aria-live="polite" className="space-y-2.5 pb-4 pl-[22px] text-[13px]">
        {rows.map((row, i) => {
          if (row.kind === "thought") {
            return (
              <li key={i} className="pl-6 text-xs leading-5 text-ink-3">
                {row.text}
              </li>
            );
          }
          if (row.kind === "info") {
            return (
              <li key={i} className="pl-6 text-xs leading-5 text-warn">
                {row.text}
              </li>
            );
          }
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-[3px] flex w-3.5 shrink-0 justify-center">
                {!row.done && !loading ? (
                  <span className="mt-1.5 block h-px w-2.5 bg-ink-4" />
                ) : !row.done ? (
                  <SpinnerIcon size={13} className="text-accent" />
                ) : row.ok ? (
                  <CheckIcon size={14} className="text-accent" />
                ) : (
                  <XIcon size={14} className="text-neg" />
                )}
                <span className="sr-only">{!row.done ? (loading ? "In progress" : "Not completed") : row.ok ? "Done" : "Failed"}</span>
              </span>
              <span className="min-w-0">
                <span className={row.done ? "text-ink-2" : "text-ink"}>{row.label}</span>
                {row.done && (
                  <span className={`block text-xs leading-5 ${row.ok ? "text-ink-3" : "text-neg"}`}>{row.summary}</span>
                )}
              </span>
            </li>
          );
        })}
        {loading && !rows.length && <li className="pl-6 text-xs text-ink-3">Starting…</li>}
      </ol>
    </details>
  );
}
