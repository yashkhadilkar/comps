import Link from "next/link";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { STATUS_LABEL } from "@/lib/audit/report";
import type { ResearchAuditFinding, ResearchAuditSummary } from "@/lib/audit/types";

const COVERAGE =
  "Comparability checks cover revenue, operating income, operating margin and net income where sufficient evidence is available. Other metrics in this research have not been audited.";

const STATUS_TEXT: Record<ResearchAuditFinding["status"], string> = {
  COMPARABLE: "text-pos",
  ADJUSTED: "text-accent",
  PARTIALLY_COMPARABLE: "text-warn",
  NOT_COMPARABLE: "text-neg",
  INSUFFICIENT_EVIDENCE: "text-ink-3",
};

function auditHref(pair: string, period: string) {
  const [a, b] = pair.split(" vs ");
  const p = /^FY(\d{4})$/.exec(period)?.[1] ?? "latest";
  return `/audit?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}&period=${p}`;
}

// Deterministic comparability review shown above a research answer. Explains, never changes, the answer below it.
export function ComparabilityCautions({ audit }: { audit: ResearchAuditSummary }) {
  const pairs = [...new Set(audit.findings.map((f) => f.pair))];
  const multiPair = pairs.length > 1;
  const issues = audit.findings.filter((f) => f.status !== "COMPARABLE");
  const ok = audit.findings.filter((f) => f.status === "COMPARABLE");

  return (
    <section aria-label="Comparability review" className="mt-8 rounded-md border border-line-subtle bg-raised px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
          {issues.length ? "Comparability cautions" : "Comparability review"}
        </h2>
        <span className="text-xs text-ink-4">Audited period: {audit.auditedPeriod}</span>
      </div>

      {audit.status === "unavailable" ? (
        <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-ink-2">
          <InfoIcon size={14} className="mt-0.5 shrink-0 text-ink-3" />
          Comparability review unavailable. The financial research below remains available, but its cross-company comparability has not been
          independently checked by the audit engine.
        </p>
      ) : (
        <>
          {audit.periodDetails.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-ink-4 [overflow-wrap:anywhere]">{audit.periodDetails.join(" · ")}</p>
          )}

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
                    {f.evidenceUrls.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {f.evidenceUrls.map((u, j) => (
                          <a
                            key={u}
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs text-ink-3 transition-colors hover:text-ink"
                          >
                            SEC filing {j + 1}
                            <ArrowUpRightIcon size={11} />
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-ink-2">
              <CheckIcon size={14} className="mt-0.5 shrink-0 text-pos" />
              {audit.checkedMetrics.length} supported metric{audit.checkedMetrics.length === 1 ? "" : "s"} checked; no material issues identified for the audited
              period.
            </p>
          )}

          {issues.length > 0 && ok.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-ink-3">
              <CheckIcon size={14} className="mt-0.5 shrink-0 text-pos" />
              Checked, no issues: {ok.map((f) => (multiPair ? `${f.metric} (${f.pair})` : f.metric)).join(", ")}.
            </p>
          )}
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-line-subtle pt-3 text-xs leading-5 text-ink-4">
        {audit.limitations.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {audit.uncheckedMetrics.length > 0 && <p>Not audited in this research: {audit.uncheckedMetrics.join(", ")}.</p>}
        <p>{COVERAGE}</p>
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
