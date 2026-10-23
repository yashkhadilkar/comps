"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CheckStatusIcon, CheckStatusLabel, ReadinessBadge, ReadinessLegend } from "@/components/audit/integrity-badges";
import { StatePanel } from "@/components/research/state-panel";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, ChevronRightIcon, SpinnerIcon, XIcon } from "@/components/ui/icons";
import { auditToMarkdown, BASIS_LABEL, INTEGRITY_SUBTITLE, INTEGRITY_TITLE, READINESS_EXPLANATION, READINESS_LABEL, STATUS_LABEL } from "@/lib/audit/report";
import type { ComparabilityAudit, ComparabilityStatus, IntegrityCheck, MetricAudit, MetricIntegrity } from "@/lib/audit/types";

// Solid fills so the outcome reads at a glance; white text is at least 5.6:1 on each fill.
const STATUS_STYLE: Record<ComparabilityStatus, string> = {
  COMPARABLE: "border-pos bg-pos text-white",
  ADJUSTED: "border-accent bg-accent text-white",
  PARTIALLY_COMPARABLE: "border-warn bg-warn text-white",
  NOT_COMPARABLE: "border-neg bg-neg text-white",
  INSUFFICIENT_EVIDENCE: "border-ink-3 bg-ink-3 text-white",
};

const EXAMPLES: [string, string, string][] = [
  ["KO", "PEP", "latest"],
  ["NKE", "LULU", "2024"],
  ["MSFT", "GOOGL", "latest"],
];

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 12 }, (_, i) => String(thisYear - i));

const inputClass =
  "h-10 w-full rounded-md border border-line bg-canvas px-3 text-[14px] uppercase text-ink outline-none transition-colors duration-150 placeholder:normal-case placeholder:text-ink-4 focus:border-line-strong";

function StatusBadge({ status }: { status: ComparabilityStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-wider text-ink-4">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function IntegrityCheckItem({ c }: { c: IntegrityCheck }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5 text-ink-2">
      <CheckStatusIcon status={c.status} />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <div>
          <CheckStatusLabel status={c.status} /> <span className="font-medium text-ink">{c.title}</span>
          {c.ticker && <span className="text-ink-4"> · {c.ticker}</span>}
        </div>
        <p>{c.finding}</p>
        <p className="text-xs text-ink-3">{c.implication}</p>
        {(c.references ?? []).length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-3">
            {c.references!.map((r) => (
              <a key={r.accession} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-ink-3 hover:text-ink">
                {r.label}
                <ArrowUpRightIcon size={11} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function IntegrityPanel({ g }: { g: MetricIntegrity }) {
  const limits = new Set(["revisions", "accounting_policy"]);
  const groups: [string, IntegrityCheck[]][] = [
    ["Cross-company checks", g.checks.filter((c) => c.scope === "comparison" && !limits.has(c.id))],
    ["Each company's own series", g.checks.filter((c) => c.scope === "history")],
    ["Coverage limits", g.checks.filter((c) => limits.has(c.id))],
  ];
  return (
    <>
      <div
        className={`mt-3 rounded-md border px-3 py-2 text-[14px] leading-6 ${g.readiness === "BLOCKED" ? "border-neg/40 bg-canvas text-ink-2" : "border-line-subtle bg-canvas text-ink-2"}`}
      >
        <p className="text-[13px] text-ink-3">
          <span className="font-medium text-ink-2">{READINESS_LABEL[g.readiness]}.</span> {READINESS_EXPLANATION[g.readiness]}
        </p>
        {g.withheldConclusionReason ? (
          <>
            <span className="font-medium text-neg">Comparison not supported.</span> {g.withheldConclusionReason}
          </>
        ) : (
          g.allowableConclusion
        )}
        <p className="mt-1 text-[13px] text-ink-3">
          <span className="font-medium text-ink-2">Next step:</span> {g.analystAction}
        </p>
        {g.trend && (
          <p className="mt-1 text-[13px] text-ink-3">
            <span className="font-medium text-ink-2">Multi-year trend (separate from the audited year): {READINESS_LABEL[g.trend.readiness]}.</span>{" "}
            {g.trend.summary}
          </p>
        )}
      </div>
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <div key={title} className="mt-3">
            <h4 className="text-xs font-medium text-ink-3">{title}</h4>
            <ul className="mt-1.5 space-y-2">
              {list.map((c, i) => (
                <IntegrityCheckItem key={i} c={c} />
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}

function MetricCard({ m }: { m: MetricAudit }) {
  const sources = m.values.flatMap((v) => v.evidence).filter((e, i, all) => all.findIndex((x) => x.sourceId === e.sourceId) === i);
  const g = m.integrity;
  return (
    <article
      className="rounded-lg border border-line-subtle bg-raised px-4 py-4 sm:px-5"
      aria-label={`${m.label}: ${STATUS_LABEL[m.status]}${g ? `, readiness ${READINESS_LABEL[g.readiness]}` : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-medium text-ink">{m.label}</h3>
          <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{m.definition}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {g && (
            <span className="flex items-center gap-1 text-[11px] text-ink-4">
              Readiness <ReadinessBadge readiness={g.readiness} />
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-ink-4">
            {g && "Comparability"} <StatusBadge status={m.status} />
          </span>
        </div>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {m.values.map((v) => (
          <div key={v.ticker} className="rounded-md border border-line-subtle bg-canvas px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
              {v.ticker}
              {v.sourceBasis && <span className="text-ink-4">{BASIS_LABEL[v.sourceBasis]}</span>}
            </div>
            <div className="mt-0.5 text-[20px] font-medium tabular-nums text-ink">{v.display ?? <span className="text-ink-4">Not available</span>}</div>
            <div className="mt-0.5 text-xs text-ink-4">
              {v.periodEnd
                ? `FY${v.fiscalYear} · ${v.periodStart ? `${v.periodStart} to ${v.periodEnd}` : `ended ${v.periodEnd}`} · ${v.unit === "percent" ? "derived" : v.currency}`
                : "No evidenced value in SEC structured data for this period"}
            </div>
            {v.evidence[0]?.xbrlConcept && <div className="mt-0.5 break-all text-xs text-ink-4">us-gaap:{v.evidence[0].xbrlConcept}</div>}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[14px] leading-6 text-ink-2">{m.explanation}</p>

      {g ? (
        <IntegrityPanel g={g} />
      ) : (
        <ul className="mt-3 space-y-1.5">
          {m.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-5 text-ink-2">
              {c.passed ? <CheckIcon size={14} className="mt-0.5 shrink-0 text-pos" /> : <XIcon size={14} className="mt-0.5 shrink-0 text-warn" />}
              <span>
                <span className="text-ink-3">{c.id}:</span> {c.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {m.adjustments.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-ink-3">Adjustments and derivations</h4>
          <ul className="mt-1.5 space-y-2">
            {m.adjustments.map((a, i) => (
              <li key={i} className="text-[13px] leading-5 text-ink-2">
                {a.description}
                <code className="mt-1 block overflow-x-auto rounded bg-canvas px-2 py-1 font-mono text-[12px] text-ink-3">
                  {a.formula}
                  {a.outputDisplay ? ` = ${a.outputDisplay}` : ""}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.caveats.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-l-2 border-warn/50 pl-3">
          {m.caveats.map((c, i) => (
            <li key={i} className="text-[13px] leading-5 text-ink-2">
              {c}
            </li>
          ))}
        </ul>
      )}

      {m.aiNotes.length > 0 && (
        <div className="mt-4 rounded-md bg-accent-soft px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-accent">AI note · explains, does not change findings</div>
          {m.aiNotes.map((n, i) => (
            <p key={i} className="mt-1 text-[13px] leading-5 text-ink-2">
              {n}
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-4">
        <span>Evidence: {m.evidenceQuality.toLowerCase()}</span>
        <span className={m.requiresHumanReview ? "text-warn" : ""}>Human review: {m.requiresHumanReview ? "required" : "not required"}</span>
      </div>

      {sources.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] text-ink-3 transition-colors hover:text-ink">
            <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
            Evidence details ({sources.length} filing{sources.length === 1 ? "" : "s"})
          </summary>
          <ul className="mt-2 space-y-2">
            {sources.map((e) => (
              <li key={e.sourceId}>
                <a
                  href={e.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-subtle"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink">{e.documentTitle}</span>
                    <span className="block break-all text-xs text-ink-4">
                      Accession {e.accessionNumber}
                      {e.xbrlConcept ? ` · us-gaap:${e.xbrlConcept}` : ""}
                    </span>
                  </span>
                  <ArrowUpRightIcon size={14} className="mt-0.5 shrink-0 text-ink-4 group-hover/link:text-ink-2" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function AuditResult({ audit }: { audit: ComparabilityAudit }) {
  const [checked, setChecked] = useState<boolean[]>(() => audit.reviewChecklist.map(() => false));
  const [ca, cb] = audit.companies;

  function download() {
    const blob = new Blob([auditToMarkdown(audit, checked)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `comps-audit-${ca.ticker}-${cb.ticker}-${audit.generatedAt.slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8">
      <section className="rounded-lg border border-line bg-raised px-4 py-5 sm:px-6" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold text-ink">
              {ca.ticker} vs {cb.ticker}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              {ca.name} · {cb.name}
            </p>
          </div>
          <StatusBadge status={audit.overallStatus} />
        </div>
        <p className="mt-4 text-[15px] leading-6 text-ink-2">{audit.overallAssessment}</p>
        {audit.integrity && (
          <div className="mt-3 rounded-md border border-line-subtle bg-canvas px-3 py-2 text-[14px] leading-6 text-ink-2">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-3">{INTEGRITY_TITLE}</span>
            <span className="block text-xs text-ink-3">{INTEGRITY_SUBTITLE}</span>
            <span className="mt-1 block">{audit.integrity.verdict}</span>
            <div className="mt-2">
              <ReadinessLegend states={audit.metrics.flatMap((m) => (m.integrity ? [m.integrity.readiness] : []))} />
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs leading-5 text-ink-3">
              {audit.integrity.coverage.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {audit.aiInterpretation && (
          <p className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-[14px] leading-6 text-ink-2">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-accent">AI interpretation</span>
            {audit.aiInterpretation}
          </p>
        )}
        {audit.partial && (
          <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-warn">
            <AlertIcon size={14} className="mt-0.5 shrink-0" />
            Partial audit: some metrics have insufficient evidence and are not compared.
          </p>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="text-xs text-ink-4">
              <tr className="border-b border-line-subtle">
                <th className="py-2 pr-3 font-normal">Metric</th>
                <th className="py-2 pr-3 font-normal">{ca.ticker}</th>
                <th className="py-2 pr-3 font-normal">{cb.ticker}</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                {audit.integrity && <th className="py-2 font-normal">Readiness</th>}
              </tr>
            </thead>
            <tbody>
              {audit.metrics.map((m) => (
                <tr key={m.metricId} className="border-b border-line-subtle last:border-0">
                  <td className="py-2 pr-3 text-ink">{m.label}</td>
                  {m.values.map((v) => (
                    <td key={v.ticker} className="py-2 pr-3 tabular-nums text-ink-2">
                      {v.display ?? <span className="text-ink-4">—</span>}
                    </td>
                  ))}
                  <td className="py-2 pr-3">
                    <StatusBadge status={m.status} />
                  </td>
                  {audit.integrity && <td className="py-2">{m.integrity ? <ReadinessBadge readiness={m.integrity.readiness} /> : <span className="text-ink-4">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Section
        title="Metric review"
        action={
          <button
            type="button"
            onClick={download}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink"
          >
            Download report (.md)
          </button>
        }
      >
        <div className="space-y-4">
          {audit.metrics.map((m) => (
            <MetricCard key={m.metricId} m={m} />
          ))}
        </div>
      </Section>

      <Section title="Analyst review checklist">
        <ul className="space-y-1 rounded-lg border border-line-subtle bg-raised px-4 py-3">
          {audit.reviewChecklist.map((item, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-3 py-1 text-[14px] leading-6 text-ink-2">
                <input
                  type="checkbox"
                  checked={checked[i] ?? false}
                  onChange={(e) => setChecked((prev) => prev.map((x, j) => (j === i ? e.target.checked : x)))}
                  className="mt-1.5 h-4 w-4 shrink-0 accent-(--accent)"
                />
                <span className={checked[i] ? "text-ink-4 line-through" : ""}>{item}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Limitations">
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-5 text-ink-3">
          {audit.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "error"; message: string }
  | { kind: "done"; audit: ComparabilityAudit };

export function AuditWorkspace({ initial }: { initial?: { tickerA: string; tickerB: string; period: string } }) {
  const [tickerA, setTickerA] = useState(initial?.tickerA ?? "");
  const [tickerB, setTickerB] = useState(initial?.tickerB ?? "");
  const [period, setPeriod] = useState(initial?.period && YEARS.includes(initial.period) ? initial.period : "latest");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run(a: string, b: string, p: string) {
    const ta = a.trim().toUpperCase();
    const tb = b.trim().toUpperCase();
    if (!ta || !tb) return setState({ kind: "error", message: "Enter both tickers." });
    if (ta === tb) return setState({ kind: "error", message: "Choose two different companies." });
    setState({ kind: "loading", label: `Auditing ${ta} vs ${tb}` });
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickerA: ta, tickerB: tb, period: p }),
      });
      const body = (await res.json().catch(() => null)) as { audit?: ComparabilityAudit; error?: string } | null;
      if (!res.ok || !body?.audit) {
        setState({ kind: "error", message: body?.error ?? `The audit failed (${res.status}). Please try again.` });
        return;
      }
      setState({ kind: "done", audit: body.audit });
    } catch {
      setState({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(tickerA, tickerB, period);
  }

  const busy = state.kind === "loading";

  return (
    <div className="mx-auto w-full max-w-(--answer-max) flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      <header>
        <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Comparability Audit</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-6 text-ink-3">
          Financial comparison integrity review: before you trust a comp, check its evidence. For each metric, Comps checks
          source evidence, fiscal periods, currency, XBRL definitions and formulas from SEC 10-K data, then says whether the
          comparison is ready, needs review, or is blocked, and what to do next. Not a statutory audit.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mt-6 rounded-lg border border-line bg-raised p-4" aria-label="Audit inputs">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Company A ticker</span>
            <input value={tickerA} onChange={(e) => setTickerA(e.target.value)} placeholder="e.g. KO" maxLength={10} className={inputClass} disabled={busy} autoComplete="off" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Company B ticker</span>
            <input value={tickerB} onChange={(e) => setTickerB(e.target.value)} placeholder="e.g. PEP" maxLength={10} className={inputClass} disabled={busy} autoComplete="off" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Reporting period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${inputClass} normal-case`} disabled={busy}>
              <option value="latest">Latest fiscal year</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  FY{y} (Company A)
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-canvas transition-colors duration-150 hover:bg-accent-hover disabled:bg-subtle disabled:text-ink-4"
          >
            {busy && <SpinnerIcon size={14} />}
            Run Audit
          </button>
        </div>
      </form>

      {state.kind === "idle" && (
        <div className="mt-8">
          <StatePanel title="No audit yet">
            Pick two US-listed companies. Comps compares revenue, operating income, operating margin and net income, and flags
            anything that would make a side-by-side comparison misleading.
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map(([a, b, p]) => (
                <button
                  key={a + b}
                  type="button"
                  onClick={() => {
                    setTickerA(a);
                    setTickerB(b);
                    setPeriod(p);
                    void run(a, b, p);
                  }}
                  className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink"
                >
                  {a} vs {b} · {p === "latest" ? "latest" : `FY${p}`}
                </button>
              ))}
            </div>
          </StatePanel>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-line-subtle bg-raised px-5 py-4 text-[14px] text-ink-2" role="status">
          <SpinnerIcon size={16} className="text-ink-3" />
          {state.label}: pulling 10-K facts from SEC EDGAR, checking periods, currency and definitions…
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-8">
          <StatePanel tone="error" title="The audit could not run">
            {state.message}
          </StatePanel>
        </div>
      )}

      {state.kind === "done" && <AuditResult key={state.audit.auditId} audit={state.audit} />}
    </div>
  );
}
