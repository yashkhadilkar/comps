import Link from "next/link";
import { CheckStatusIcon, ReadinessBadge } from "@/components/audit/integrity-badges";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, ChevronRightIcon, InfoIcon } from "@/components/ui/icons";
import { BASIS_LABEL, CHECK_LABEL, INTEGRITY_SUBTITLE, INTEGRITY_TITLE, READINESS_EXPLANATION, STATUS_LABEL } from "@/lib/audit/report";
import type { CheckStatus, Readiness, ResearchAuditFinding, ResearchAuditSummary } from "@/lib/audit/types";

const COVERAGE =
  "Integrity checks cover revenue, operating income, operating margin and net income where sufficient evidence is available. Other metrics in this research have not been audited.";

const STATUS_TEXT: Record<ResearchAuditFinding["status"], string> = {
  COMPARABLE: "text-pos",
  ADJUSTED: "text-accent",
  PARTIALLY_COMPARABLE: "text-warn",
  NOT_COMPARABLE: "text-neg",
  INSUFFICIENT_EVIDENCE: "text-ink-3",
};

const ORDER: Record<Readiness, number> = { BLOCKED: 0, REVIEW: 1, READY: 2 };

function auditHref(pair: string, period: string) {
  const [a, b] = pair.split(" vs ");
  const p = /^FY(\d{4})$/.exec(period)?.[1] ?? "latest";
  return `/audit?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}&period=${p}`;
}

function EvidenceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {urls.map((u, j) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-ink-3 transition-colors hover:text-ink">
          SEC filing {j + 1}
          <ArrowUpRightIcon size={11} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </div>
  );
}

const HISTORY = new Set(["series_continuity", "tag_lineage"]); // each company's own series: shown as the trend
const LIMITS = new Set(["revisions", "accounting_policy"]); // fixed coverage limits: stated once in the footer

const nameOf = (f: ResearchAuditFinding, multiPair: boolean) => (multiPair ? `${f.metric} (${f.pair})` : f.metric);
// Operating margin inherits its inputs' checks with a "Revenue: " / "Operating income: " prefix; the same fact then
// reads identically for both metrics and is listed once.
const plain = (finding: string) => finding.replace(/^(Revenue|Operating income): /, "");

type Line = { status: CheckStatus; title: string; text: string };

// Metrics that share a verdict, the same reasons and the same next step are shown as one entry.
function groupBy<T>(items: ResearchAuditFinding[], key: (f: ResearchAuditFinding) => string, make: (f: ResearchAuditFinding[]) => T): T[] {
  const groups = new Map<string, ResearchAuditFinding[]>();
  for (const f of items) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]);
  return [...groups.values()].map(make);
}

function currentLines(f: ResearchAuditFinding): Line[] {
  const lines = (f.checks ?? [])
    .filter((c) => !HISTORY.has(c.id) && !LIMITS.has(c.id))
    // A blocked metric lists what blocks or qualifies it; checks skipped because a value is missing are in the detailed audit.
    .filter((c) => f.readiness !== "BLOCKED" || c.status === "FAIL" || c.status === "CAUTION")
    .map((c) => ({ status: c.status, title: c.title, text: plain(c.finding) }));
  return lines.filter((l, i) => lines.findIndex((x) => x.text === l.text) === i);
}

function CheckLines({ lines }: { lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {lines.map((l, i) => (
        <li key={i} title={l.title} className="flex items-start gap-1.5 text-xs leading-5 text-ink-2">
          <CheckStatusIcon status={l.status} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="sr-only">{CHECK_LABEL[l.status]}, {l.title}: </span>
            {l.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

// One entry: metrics with the same readiness and reasons. Comparability status and source basis per metric are
// secondary, so they sit in a disclosure.
function IntegrityGroup({ items, multiPair }: { items: ResearchAuditFinding[]; multiPair: boolean }) {
  const f = items[0];
  const readiness = f.readiness!;
  const urls = [...new Set(items.flatMap((x) => x.evidenceUrls))];
  return (
    <li className="text-[13px] leading-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ReadinessBadge readiness={readiness} size="sm" />
        <span className="font-medium text-ink">{items.map((x) => nameOf(x, multiPair)).join(" · ")}</span>
      </div>
      <p className="mt-0.5 text-xs leading-5 text-ink-3">
        {readiness === "BLOCKED" && <span className="font-medium text-neg">Comparison not supported. </span>}
        {READINESS_EXPLANATION[readiness]}
      </p>
      <CheckLines lines={currentLines(f)} />
      {readiness !== "READY" && (f.analystAction || urls.length > 0) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs leading-5 text-ink-3">
          {f.analystAction && (
            <span>
              <span className="font-medium text-ink-2">Next step:</span> {f.analystAction}
            </span>
          )}
          <EvidenceLinks urls={urls} />
        </div>
      )}
      <details className="group mt-0.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-ink-4 transition-colors hover:text-ink-2">
          <ChevronRightIcon size={12} className="transition-transform group-open:rotate-90" />
          Status and sources
        </summary>
        <ul className="mt-0.5 space-y-0.5 pl-4 text-xs leading-5 text-ink-3">
          {items.map((x, i) => (
            <li key={i}>
              {nameOf(x, multiPair)}: comparability <span className={STATUS_TEXT[x.status]}>{STATUS_LABEL[x.status].toLowerCase()}</span>
              {Object.entries(x.sourceBasis ?? {}).map(([t, b]) => ` · ${t} ${BASIS_LABEL[b].toLowerCase()}`).join("")}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

// Multi-year findings, kept apart from the audited year: each metric's trend status, then every distinct finding
// once, naming the metrics it affects when it is not all of them. Metrics whose audited year is already unsupported
// are left out: their trend cannot be better.
function TrendBlock({ findings, multiPair }: { findings: ResearchAuditFinding[]; multiPair: boolean }) {
  const relevant = findings.filter((f) => f.trend && f.trend.readiness !== "READY" && f.readiness !== "BLOCKED");
  if (!relevant.length) return null;
  const lines: (Line & { metrics: string[] })[] = [];
  for (const f of relevant) {
    for (const c of (f.checks ?? []).filter((x) => HISTORY.has(x.id) && x.status !== "PASS")) {
      const text = plain(c.finding);
      const hit = lines.find((l) => l.text === text);
      if (hit) hit.metrics.push(nameOf(f, multiPair));
      else lines.push({ status: c.status, title: c.title, text, metrics: [nameOf(f, multiPair)] });
    }
  }
  const anyBlocked = relevant.some((f) => f.trend!.readiness === "BLOCKED");
  return (
    <div className="mt-3 border-t border-line-subtle pt-3 text-[13px] leading-5">
      <h3 className="text-xs font-medium text-ink-2">Multi-year trend (separate from the audited year)</h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {relevant.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="font-medium text-ink">{nameOf(f, multiPair)}</span>
            <ReadinessBadge readiness={f.trend!.readiness} size="sm" />
          </span>
        ))}
      </div>
      <p className="mt-0.5 text-xs leading-5 text-ink-3">
        {anyBlocked ? "Growth across a break in the annual series is not supported; years on either side remain usable." : "Qualify any trend with the points below."}
      </p>
      <CheckLines lines={lines.map((l) => ({ ...l, text: l.metrics.length < relevant.length ? `${l.text} (${l.metrics.join(", ")})` : l.text }))} />
    </div>
  );
}

function LegacyFindings({ audit, multiPair }: { audit: ResearchAuditSummary; multiPair: boolean }) {
  const issues = audit.findings.filter((f) => f.status !== "COMPARABLE");
  const ok = audit.findings.filter((f) => f.status === "COMPARABLE");
  return (
    <>
      {issues.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {issues.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <AlertIcon size={14} className={`mt-1 shrink-0 ${STATUS_TEXT[f.status]}`} />
              <div className="min-w-0 text-[13px] leading-5">
                <div>
                  <span className="font-medium text-ink">{f.metric}</span>
                  {multiPair && <span className="text-ink-4"> · {f.pair}</span>}
                  <span className={`ml-2 text-xs ${STATUS_TEXT[f.status]}`}>{STATUS_LABEL[f.status]}</span>
                </div>
                <p className="mt-0.5 text-ink-2">{f.explanation}</p>
                <EvidenceLinks urls={f.evidenceUrls} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-ink-2">
          <CheckIcon size={14} className="mt-0.5 shrink-0 text-pos" />
          {audit.checkedMetrics.length} supported metric{audit.checkedMetrics.length === 1 ? "" : "s"} checked; no material issues identified for the audited period.
        </p>
      )}
      {issues.length > 0 && ok.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-ink-3">
          <CheckIcon size={14} className="mt-0.5 shrink-0 text-pos" />
          Checked, no issues: {ok.map((f) => (multiPair ? `${f.metric} (${f.pair})` : f.metric)).join(", ")}.
        </p>
      )}
    </>
  );
}

// Deterministic integrity review shown below a research answer. The answer was generated (and streamed) before this
// review ran and is never edited by it, so the review states which of the answer's comparisons are supported. Summaries saved before V2 have no readiness and render the earlier comparability view.
export function ComparabilityCautions({ audit }: { audit: ResearchAuditSummary }) {
  const pairs = [...new Set(audit.findings.map((f) => f.pair))];
  const multiPair = pairs.length > 1;
  const v2 = audit.findings.length > 0 && audit.findings.every((f) => f.readiness);
  const sorted = [...audit.findings].sort((a, b) => ORDER[a.readiness ?? "READY"] - ORDER[b.readiness ?? "READY"]);
  const legacyIssues = audit.findings.some((f) => f.status !== "COMPARABLE");

  return (
    <section aria-label="Financial comparison integrity" className="mt-8 rounded-md border border-line-subtle bg-raised px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
          {v2 ? INTEGRITY_TITLE : legacyIssues ? "Comparability cautions" : "Comparability review"}
        </h2>
        <span className="text-xs text-ink-4">Audited period: {audit.auditedPeriod}</span>
      </div>
      {v2 && <p className="mt-1 text-xs leading-5 text-ink-3">{INTEGRITY_SUBTITLE}</p>}

      {audit.status === "unavailable" ? (
        <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-ink-2">
          <InfoIcon size={14} className="mt-0.5 shrink-0 text-ink-3" />
          Comparison integrity review unavailable. The financial research below remains available, but its cross-company comparability has not been
          independently checked by the audit engine.
        </p>
      ) : (
        <>
          {audit.periodDetails.length > 0 && <p className="mt-1 text-xs leading-5 text-ink-4 [overflow-wrap:anywhere]">{audit.periodDetails.join(" · ")}</p>}

          {v2 ? (
            <>
              <ul className="mt-3 space-y-3">
                {groupBy(sorted, (f) => `${f.readiness}|${f.readiness === "READY" ? "" : f.analystAction}|${JSON.stringify(currentLines(f).map((l) => l.text))}`, (items) => items).map(
                  (items, i) => (
                    <IntegrityGroup key={i} items={items} multiPair={multiPair} />
                  ),
                )}
              </ul>
              <TrendBlock findings={sorted} multiPair={multiPair} />
            </>
          ) : (
            <LegacyFindings audit={audit} multiPair={multiPair} />
          )}
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-line-subtle pt-3 text-xs leading-5 text-ink-4">
        {audit.limitations.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {v2 ? (
          <p>
            {`Checked: ${audit.checkedMetrics.join(", ").toLowerCase()}. Not audited: ${audit.uncheckedMetrics.length ? audit.uncheckedMetrics.join(", ").toLowerCase() : "other metrics"}, accounting-policy and footnote equivalence. Run after the answer above was written; the answer is not edited.`}
          </p>
        ) : (
          <>
            {audit.uncheckedMetrics.length > 0 && <p>Not audited in this research: {audit.uncheckedMetrics.join(", ")}.</p>}
            <p>{COVERAGE}</p>
          </>
        )}
        {pairs.length > 0 && (
          <p className="flex flex-wrap gap-x-3">
            {pairs.map((p) => (
              <Link key={p} href={auditHref(p, audit.auditedPeriod)} className="text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                View detailed audit{multiPair ? ` (${p})` : ""}
              </Link>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}
