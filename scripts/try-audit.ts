// Offline (no SEC, no LLM): comparability engine, contract validation, grounding filter and the /api/audit handler.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-audit.ts
import { buildAudit, verifyDerivation, type CompanyData, type FactRow } from "../lib/audit/engine";
import { handleAudit, resetLimiterForTests, AUDITS_PER_WINDOW, type AuditDeps } from "../lib/audit/handler";
import { interpretAudit, noteIsGrounded } from "../lib/audit/interpret";
import { auditToMarkdown } from "../lib/audit/report";
import { parseAuditRequest, validateAudit, type ComparabilityAudit } from "../lib/audit/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const row = (fy: number, end: string, value: number, acc: string, tag = "Revenues"): FactRow => ({
  fiscalYear: fy, periodEnd: end, value, form: "10-K", filed: "2025-02-01", tag, citationKey: acc,
});

function company(ticker: string, end: string, fy: number, v: { rev?: number; oi?: number | null; ni?: number; revTag?: string; niTag?: string }, opts: Partial<CompanyData> = {}): CompanyData {
  const acc = `${ticker}-ACC`;
  return {
    company: { ticker, name: `${ticker} Inc.`, cik: 1 },
    metrics: {
      revenue: v.rev === undefined ? [] : [row(fy, end, v.rev, acc, v.revTag)],
      operating_income: v.oi == null ? [] : [row(fy, end, v.oi, acc, "OperatingIncomeLoss")],
      net_income: v.ni === undefined ? [] : [row(fy, end, v.ni, acc, v.niTag ?? "NetIncomeLoss")],
    },
    nonUsdUnits: {},
    filings: { [acc]: { url: `https://www.sec.gov/${ticker}`, form: "10-K", filed: "2025-02-01" } },
    ...opts,
  };
}

const opts = { auditId: "t", now: new Date("2026-10-21T00:00:00Z") };
const metric = (a: ComparabilityAudit, id: string) => a.metrics.find((m) => m.metricId === id)!;

async function main() {
  // 1. Comparable same-period data
  {
    const a = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), company("BBB", "2025-12-27", 2025, { rev: 4000, oi: 400, ni: 300 }), 2025, opts);
    const m = metric(a, "operating_margin");
    check("T01 same period -> all COMPARABLE", a.metrics.every((x) => x.status === "COMPARABLE") && a.overallStatus === "COMPARABLE", a.metrics.map((x) => x.status));
    check("T01 margin via calculate: 20 and 10", m.values[0].normalizedValue === 20 && m.values[1].normalizedValue === 10, m.values);
    check("T01 margin formula recorded with sources", m.adjustments.length === 2 && m.adjustments[0].formula === "200 / 1000 * 100" && m.adjustments[0].inputSourceIds[0] === "AAA-ACC");
    check("T01 contract validates", validateAudit(a).length === 0, validateAudit(a));
    check("T01 no human review", !a.requiresHumanReview && !a.partial);
  }

  // 2. Fiscal-period mismatch: May year-end vs early-Feb year-end (label-matched year 247 days away)
  {
    const nke = company("NKE", "2024-05-31", 2024, { rev: 51e9, oi: null, ni: 5.7e9 });
    const lulu: CompanyData = company("LULU", "2025-02-02", 2024, { rev: 10.6e9, oi: 2.5e9, ni: 1.8e9 });
    lulu.metrics.revenue.push(row(2023, "2024-01-28", 9.6e9, "LULU-ACC"));
    lulu.metrics.net_income.push(row(2023, "2024-01-28", 1.5e9, "LULU-ACC", "NetIncomeLoss"));
    lulu.metrics.operating_income.push(row(2023, "2024-01-28", 2.1e9, "LULU-ACC", "OperatingIncomeLoss"));
    const a = buildAudit(nke, lulu, 2024, opts);
    const rev = metric(a, "revenue");
    check("T02 realigned to nearest LULU year (2024-01-28)", rev.values[1].periodEnd === "2024-01-28", rev.values[1]);
    check("T02 realignment recorded as adjustment", rev.adjustments.some((x) => x.kind === "period_realignment"));
    check("T02 124-day gap -> PARTIALLY_COMPARABLE, disclosed", rev.status === "PARTIALLY_COMPARABLE" && rev.caveats.some((c) => c.includes("124 days")), rev);
    check("T02 human review + checklist item", rev.requiresHumanReview && a.reviewChecklist.some((c) => c.includes("124-day")));
  }
  {
    // Aligned after realignment -> ADJUSTED
    const a1 = company("AAA", "2024-12-31", 2024, { rev: 100, oi: 10, ni: 5 });
    const b1 = company("BBB", "2025-01-05", 2024, { rev: 100, oi: 10, ni: 5 }); // labelled 2024
    b1.metrics.revenue = [row(2025, "2025-12-28", 120, "BBB-ACC"), row(2024, "2025-01-05", 100, "BBB-ACC")];
    // Force a label mismatch: B labels its Jan-2025 year as 2025 instead
    b1.metrics.revenue[1].fiscalYear = 2025;
    b1.metrics.revenue[0].fiscalYear = 2024;
    b1.metrics.operating_income = [row(2024, "2025-12-28", 12, "BBB-ACC", "OperatingIncomeLoss"), row(2025, "2025-01-05", 10, "BBB-ACC", "OperatingIncomeLoss")];
    b1.metrics.net_income = [row(2024, "2025-12-28", 6, "BBB-ACC", "NetIncomeLoss"), row(2025, "2025-01-05", 5, "BBB-ACC", "NetIncomeLoss")];
    const a = buildAudit(a1, b1, 2024, opts);
    check("T02b label far, nearest within 31 days -> ADJUSTED", metric(a, "revenue").status === "ADJUSTED" && metric(a, "revenue").values[1].periodEnd === "2025-01-05", metric(a, "revenue"));
  }

  // 3. Currency mismatch
  {
    const tm = company("TM", "2025-03-31", 2025, {}, { nonUsdUnits: { revenue: ["JPY"], operating_income: ["JPY"], net_income: ["JPY"] } });
    const a = buildAudit(company("AAA", "2025-03-31", 2025, { rev: 100, oi: 10, ni: 5 }), tm, "latest", opts);
    const rev = metric(a, "revenue");
    check("T03 JPY-only metric -> NOT_COMPARABLE, no conversion", rev.status === "NOT_COMPARABLE" && rev.caveats.some((c) => c.includes("JPY") && c.includes("No documented FX rate")), rev);
    check("T03 contract validates", validateAudit(a).length === 0, validateAudit(a));
  }

  // 4. Missing evidence (Nike-style: no operating income line)
  {
    const a = buildAudit(company("NKE", "2025-05-31", 2025, { rev: 46e9, oi: null, ni: 3e9 }), company("BBB", "2025-05-31", 2025, { rev: 10e9, oi: 1e9, ni: 5e8 }), 2025, opts);
    const oi = metric(a, "operating_income");
    check("T04 missing OI -> INSUFFICIENT_EVIDENCE (not NOT_COMPARABLE)", oi.status === "INSUFFICIENT_EVIDENCE" && oi.values[0].reportedValue === null, oi);
    check("T04 caveat says not estimated", oi.caveats.some((c) => c.includes("not estimated")));
    check("T04 margin also INSUFFICIENT, no NKE margin", metric(a, "operating_margin").status === "INSUFFICIENT_EVIDENCE" && metric(a, "operating_margin").values[0].normalizedValue === null);
  }

  // 5. Unsupported adjustment: numbers not in the evidence are rejected
  {
    const r = verifyDerivation(
      { kind: "derivation", ticker: "AAA", description: "x", formula: "250 / 1000 * 100", inputSourceIds: ["A"], outputValue: 25, outputDisplay: "25%" },
      [200, 1000],
    );
    check("T05 formula with unevidenced input rejected", !r.ok && r.reason.includes("250"), r);
    const bad = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), company("BBB", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), 2025, opts);
    bad.metrics[2].adjustments[0].inputSourceIds = ["FABRICATED"];
    check("T05 adjustment citing evidence outside the metric fails validation", validateAudit(bad).some((e) => e.includes("adjustment cites")));
  }

  // 6. Incorrect calculation
  {
    const r = verifyDerivation(
      { kind: "derivation", ticker: "AAA", description: "x", formula: "200 / 1000 * 100", inputSourceIds: ["A"], outputValue: 25, outputDisplay: "25%" },
      [200, 1000],
    );
    check("T06 wrong stated output rejected", !r.ok && r.reason.includes("20"), r);
    const ok = verifyDerivation(
      { kind: "derivation", ticker: "AAA", description: "x", formula: "-200 / 1000 * 100", inputSourceIds: ["A"], outputValue: -20, outputDisplay: "-20%" },
      [-200, 1000],
    );
    check("T06 negative operating income verifies", ok.ok, ok);
    const a = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), company("BBB", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), 2025, opts);
    a.metrics[2].values[0].normalizedValue = 99;
    check("T06 tampered normalized value fails validation", validateAudit(a).some((e) => e.includes("normalized value without adjustment")));
  }

  // 7. Zero denominator
  {
    const a = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 0, oi: -50, ni: -60 }), company("BBB", "2025-12-31", 2025, { rev: 1000, oi: 100, ni: 50 }), 2025, opts);
    const m = metric(a, "operating_margin");
    check("T07 zero revenue -> margin undefined, INSUFFICIENT", m.status === "INSUFFICIENT_EVIDENCE" && m.values[0].normalizedValue === null && m.caveats.some((c) => c.includes("zero")), m);
    check("T07 contract validates", validateAudit(a).length === 0, validateAudit(a));
  }

  // 8. Partial audit: one company's retrieval failed entirely, another metric missing
  {
    const fail: CompanyData = { ...company("BBB", "2025-12-31", 2025, {}), error: "SEC EDGAR returned 503" };
    const a = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), fail, 2025, opts);
    check("T08 total retrieval failure -> INSUFFICIENT overall, explained", a.overallStatus === "INSUFFICIENT_EVIDENCE" && a.limitations[0].includes("503"), a.overallStatus);
    const b = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), company("BBB", "2025-12-31", 2025, { rev: 500, oi: null, ni: 20 }), 2025, opts);
    check("T08 mixed -> partial=true, overall PARTIALLY_COMPARABLE", b.partial && b.overallStatus === "PARTIALLY_COMPARABLE", { partial: b.partial, s: b.overallStatus });
    check("T08 definition conflict (ProfitLoss vs NetIncomeLoss) flagged", buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1, oi: 1, ni: 1, niTag: "ProfitLoss" }), company("BBB", "2025-12-31", 2025, { rev: 1, oi: 1, ni: 1 }), 2025, opts).metrics[3].status === "PARTIALLY_COMPARABLE");
    const md = auditToMarkdown(b, [true]);
    check("T08 markdown report has statuses, sources and checklist", md.includes("Insufficient evidence") && md.includes("https://www.sec.gov/AAA") && md.includes("- [x] "));
  }

  // 9. Invalid input
  {
    check("T09 missing tickers", !parseAuditRequest({}).ok);
    check("T09 same ticker", !parseAuditRequest({ tickerA: "ko", tickerB: "KO" }).ok);
    check("T09 injection-y ticker", !parseAuditRequest({ tickerA: "KO; DROP", tickerB: "PEP" }).ok);
    check("T09 bad period", !parseAuditRequest({ tickerA: "KO", tickerB: "PEP", period: "1999" }).ok && !parseAuditRequest({ tickerA: "KO", tickerB: "PEP", period: "abc" }).ok);
    const ok = parseAuditRequest({ tickerA: " ko ", tickerB: "brk.b", period: "2024" });
    check("T09 normalizes valid input", ok.ok && ok.value.tickerA === "KO" && ok.value.tickerB === "BRK.B" && ok.value.period === 2024, ok);
  }

  // 10. Authentication, rate limit and handler wiring (no network)
  {
    resetLimiterForTests();
    let fetched = 0;
    const deps = (user: { id: string } | null): AuditDeps => ({
      getUser: async () => user,
      fetchCompany: async (t) => {
        fetched++;
        return company(t, "2025-12-31", 2025, { rev: 1000, oi: 100, ni: 50 });
      },
      interpret: null,
    });
    const anon = await handleAudit({ tickerA: "KO", tickerB: "PEP" }, deps(null));
    check("T10 unauthenticated -> 401, no retrieval", anon.status === 401 && fetched === 0, anon);
    const bad = await handleAudit({ tickerA: "KO" }, deps({ id: "u1" }));
    check("T10 invalid body -> 400, no retrieval", bad.status === 400 && fetched === 0, bad);
    const good = await handleAudit({ tickerA: "KO", tickerB: "PEP" }, deps({ id: "u1" }));
    check("T10 authenticated -> 200 with valid audit", good.status === 200 && "audit" in good.body && validateAudit(good.body.audit).length === 0, good.status);
    for (let i = 1; i < AUDITS_PER_WINDOW; i++) await handleAudit({ tickerA: "KO", tickerB: "PEP" }, deps({ id: "u1" }));
    const limited = await handleAudit({ tickerA: "KO", tickerB: "PEP" }, deps({ id: "u1" }));
    check("T10 rate limit -> 429 after window quota", limited.status === 429, limited);
    const other = await handleAudit({ tickerA: "KO", tickerB: "PEP" }, deps({ id: "u2" }));
    check("T10 limit is per user", other.status === 200);
  }

  // 11. Bounded AI interpretation: ungrounded notes dropped, failure is harmless
  {
    const a = buildAudit(company("AAA", "2025-12-31", 2025, { rev: 1000, oi: 200, ni: 100 }), company("BBB", "2025-12-31", 2025, { rev: 4000, oi: 400, ni: 300 }), 2025, opts);
    const r = await interpretAudit(a, async () => ({
      metricNotes: [
        { metricId: "revenue", note: "Both companies report revenue on the same basis." },
        { metricId: "revenue", note: "AAA revenue would be $1.2B after adjusting for FX." },
        { metricId: "net_income", note: "You should buy AAA." },
        { metricId: "made_up", note: "ignored" },
      ],
      overall: "The two companies are comparable for FY2025.",
    }));
    check("T11 grounded note kept, invented figure and advice dropped", r.audit.metrics[0].aiNotes.length === 1 && r.audit.metrics[3].aiNotes.length === 0 && r.dropped === 2, r);
    check("T11 overall with only audit years kept", r.audit.aiInterpretation === "The two companies are comparable for FY2025.");
    check("T11 statuses untouched", r.audit.metrics.every((m, i) => m.status === a.metrics[i].status));
    const f = await interpretAudit(a, async () => { throw new Error("timeout"); });
    check("T11 model failure leaves deterministic audit", f.error === "timeout" && f.audit.aiInterpretation === null && f.audit.metrics.every((m) => m.aiNotes.length === 0));
    check("T11 grounding helper", noteIsGrounded("Gap of 124 days.", ["124"]) && !noteIsGrounded("Gap of 125 days.", ["124"]));
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
