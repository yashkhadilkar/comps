import { planLabel, type Plan } from "@/lib/plans";

// `remaining` is the live count from lib/usage.ts: questions left in total (Free) or today (Pro).
export function PlanBadge({ plan, remaining, unlimited }: { plan: Plan; remaining?: number; unlimited?: boolean }) {
  const text = plan === "pro" ? "Pro" : "Free";
  return (
    <span
      title={planLabel(plan)}
      className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-xs text-ink-2"
    >
      {text}
      {unlimited && <span className="text-ink-3">&nbsp;· unlimited</span>}
      {!unlimited && remaining !== undefined && (
        <span className="text-ink-3">&nbsp;· {remaining} left{plan === "pro" ? " today" : ""}</span>
      )}
    </span>
  );
}
