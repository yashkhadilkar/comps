// Offline (no SEC, no LLM): comparison integrity V2 (lib/audit/integrity.ts) through the audit engine, the
// validator, the research summary and its tolerant reader. Numbered after docs/COMPS_COMPARISON_INTEGRITY_V2.md §11.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-integrity.ts
import { buildAudit, type CompanyData, type FactRow } from "../lib/audit/engine";
import { interpretAudit } from "../lib/audit/interpret";
import { makeCheck, provenanceCheck, reduceReadiness } from "../lib/audit/integrity";
import { auditToMarkdown } from "../lib/audit/report";
import { summarize, type ResearchAuditPlan } from "../lib/audit/research";
import { periodMetadata } from "../lib/audit/retrieve";
import { toResearchAudit, validateAudit, type AuditValue, type ComparabilityAudit, type IntegrityCheck } from "../lib/audit/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}

type Year = { fy: number; start?: string; end: string; rev?: number; oi?: number; ni?: number; revTag?: string; niTag?: string };
const row = (y: Year, value: number, acc: string, tag: string): FactRow => ({
  fiscalYear: y.fy, periodEnd: y.end, periodStart: y.start, value, form: "10-K", filed: "2026-06-01", tag, citationKey: acc,
});
function co(ticker: string, years: Year[], extra: Partial<CompanyData> = {}): CompanyData {
  const acc = (y: Year) => `${ticker}-${y.fy}`;
  const filings: CompanyData["filings"] = {};
  for (const y of years) filings[acc(y)] = { url: `https://www.sec.gov/Archives/${ticker}/${y.fy}`, form: "10-K", filed: "2026-06-01" };
  return {
    company: { ticker, name: `${ticker} Inc.`, cik: 1 },
    metrics: {
      revenue: years.filter((y) => y.rev !== undefined).map((y) => row(y, y.rev!, acc(y), y.revTag ?? "Revenues")),
      operating_income: years.filter((y) => y.oi !== undefined).map((y) => row(y, y.oi!, acc(y), "OperatingIncomeLoss")),
      net_income: years.filter((y) => y.ni !== undefined).map((y) => row(y, y.ni!, acc(y), y.niTag ?? "NetIncomeLoss")),
    },
    nonUsdUnits: {},
    filings,
    ...extra,
  };
}
const full = { rev: 1000, oi: 100, ni: 50 };
const opts = { auditId: "t", now: new Date("2026-10-21T00:00:00Z") };
const metric = (a: ComparabilityAudit, id: string) => a.metrics.find((m) => m.metricId === id)!;
const chk = (a: ComparabilityAudit, id: string, checkId: string, ticker?: string) =>
  metric(a, id).integrity!.checks.find((c) => c.id === checkId && (ticker === undefined || c.ticker === ticker));

async function main() {
  // 1. Two 12-month windows ending 61 and 90 days apart: informational timing, not a partial comparison.
  {
    const nke = co("NKE", [{ fy: 2026, start: "2025-06-01", end: "2026-05-31", ...full }]);
    const uaa = co("UAA", [{ fy: 2026, start: "2025-04-01", end: "2026-03-31", ...full }]);
    const a = buildAudit(nke, uaa, 2026, opts);
    const rev = metric(a, "revenue");
    check("V01 61-day gap -> period_alignment INFO", chk(a, "revenue", "period_alignment")?.status === "INFO", chk(a, "revenue", "period_alignment"));
    check("V01 legacy status stays COMPARABLE (enum unchanged), gap disclosed", rev.status === "COMPARABLE" && rev.caveats.some((c) => c.includes("61 days apart")), rev.status);
    check("V01 readiness READY with timing disclosed in the conclusion", rev.integrity?.readiness === "READY" && /disclosing: fiscal period alignment/.test(rev.integrity.allowableConclusion ?? ""), rev.integrity);
    check("V01 contract validates", validateAudit(a).length === 0, validateAudit(a));
    const b = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2024-10-03", end: "2025-10-02", ...full }]), 2025, opts);
    check("V01 90-day gap -> still INFO", chk(b, "revenue", "period_alignment")?.status === "INFO" && metric(b, "revenue").status === "COMPARABLE", chk(b, "revenue", "period_alignment"));
    const c = buildAudit(co("NKE", [{ fy: 2024, start: "2023-06-01", end: "2024-05-31", ...full }]), co("LULU", [{ fy: 2023, start: "2023-01-30", end: "2024-01-28", ...full }]), 2024, opts);
    check("V01 124-day gap (66% overlap) -> CAUTION, PARTIALLY_COMPARABLE, REVIEW", chk(c, "revenue", "period_alignment")?.status === "CAUTION" && metric(c, "revenue").status === "PARTIALLY_COMPARABLE" && metric(c, "revenue").integrity?.readiness === "REVIEW");
    const d = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2024-07-01", end: "2025-06-30", ...full }]), 2025, opts);
    check("V01 184-day gap (<50% overlap) -> FAIL, NOT_COMPARABLE, BLOCKED", chk(d, "revenue", "period_alignment")?.status === "FAIL" && metric(d, "revenue").status === "NOT_COMPARABLE" && metric(d, "revenue").integrity?.readiness === "BLOCKED", chk(d, "revenue", "period_alignment"));
  }

  // 2. Annual series with a three-month transition period: growth across it is blocked, raw facts kept.
  {
    const uaaYears: Year[] = [
      { fy: 2021, start: "2021-01-01", end: "2021-12-31", ...full },
      { fy: 2023, start: "2022-04-01", end: "2023-03-31", ...full },
      { fy: 2024, start: "2023-04-01", end: "2024-03-31", ...full },
    ];
    const transition = { start: "2022-01-01", end: "2022-03-31", days: 90, accession: "UAA-T", form: "10-K", url: "https://www.sec.gov/Archives/UAA/T" };
    const uaa = co("UAA", uaaYears, { shortPeriods: [transition] });
    const peer = co("PEER", [2021, 2022, 2023, 2024].map((y) => ({ fy: y, start: `${y - 1}-04-01`, end: `${y}-03-31`, ...full })));
    const a = buildAudit(peer, uaa, 2024, { ...opts, series: [2024, 2023, 2022, 2021] });
    const cont = chk(a, "revenue", "series_continuity", "UAA");
    check("V02 transition period -> series_continuity FAIL naming the period", cont?.status === "FAIL" && cont.finding.includes("90-day transition period (2022-01-01 to 2022-03-31") && cont.finding.includes("FY2022 not in the annual series"), cont);
    check("V02 transition filing cited as a reference", cont?.references?.some((r) => r.accession === "UAA-T") === true);
    const rev = metric(a, "revenue");
    check("V02 trend BLOCKED, single-year comparison unaffected (READY)", rev.integrity?.trend?.readiness === "BLOCKED" && rev.integrity.readiness === "READY", rev.integrity?.trend);
    check("V02 raw FY2024 values retained", rev.values.every((v) => v.reportedValue === 1000));
    check("V02 peer's continuous series passes", chk(a, "revenue", "series_continuity", "PEER")?.status === "PASS");
    check("V02 contract validates", validateAudit(a).length === 0, validateAudit(a));

    // Detection from raw company facts: the 3-month period in the gap is found; quarters inside a year are not.
    const usGaap = {
      Revenues: {
        units: {
          USD: [
            { start: "2021-01-01", end: "2021-12-31", val: 1, accn: "A1", fy: 2021, fp: "FY", form: "10-K", filed: "2022-02-01" },
            { start: "2021-10-01", end: "2021-12-31", val: 1, accn: "A1", fy: 2021, fp: "FY", form: "10-K", filed: "2022-02-01" },
            { start: "2022-01-01", end: "2022-03-31", val: 1, accn: "T1", fy: 2022, fp: "FY", form: "10-K", filed: "2023-05-01" },
            { start: "2022-04-01", end: "2023-03-31", val: 1, accn: "A2", fy: 2023, fp: "FY", form: "10-K", filed: "2023-05-01" },
            { start: "2022-04-01", end: "2022-06-30", val: 1, accn: "Q1", fy: 2023, fp: "Q1", form: "10-Q", filed: "2022-08-01" },
          ],
        },
      },
    };
    const rows = { revenue: [{ fiscalYear: 2021, periodEnd: "2021-12-31", value: 1, form: "10-K", filed: "2022-02-01", tag: "Revenues", citationKey: "A1" }, { fiscalYear: 2023, periodEnd: "2023-03-31", value: 1, form: "10-K", filed: "2023-05-01", tag: "Revenues", citationKey: "A2" }], operating_income: [], net_income: [] };
    const meta = periodMetadata(usGaap, rows, 1336917);
    check("V02 periodMetadata adds start dates from the selected fact", meta.metrics.revenue.map((r) => r.periodStart).join() === "2021-01-01,2022-04-01", meta.metrics.revenue);
    check("V02 periodMetadata finds exactly the transition period", meta.shortPeriods.length === 1 && meta.shortPeriods[0].start === "2022-01-01" && meta.shortPeriods[0].days === 90 && meta.shortPeriods[0].url.startsWith("https://www.sec.gov/"), meta.shortPeriods);
    check("V02 periodMetadata does not change selected values", meta.metrics.revenue.every((r, i) => r.value === rows.revenue[i].value && r.citationKey === rows.revenue[i].citationKey));
  }

  // 3. 52 vs 53 weeks: caution, no normalization.
  {
    const hd = co("HD", [{ fy: 2024, start: "2024-01-29", end: "2025-02-02", ...full }]);
    const low = co("LOW", [{ fy: 2024, start: "2024-02-03", end: "2025-01-31", ...full }]);
    const a = buildAudit(hd, low, 2024, opts);
    const dur = chk(a, "revenue", "period_duration");
    check("V03 371 vs 364 days -> period_duration CAUTION naming 53 weeks", dur?.status === "CAUTION" && dur.finding.includes("371 days (53 weeks)") && dur.finding.includes("364 days (52 weeks)"), dur);
    check("V03 no normalized value, no adjustment produced", metric(a, "revenue").values.every((v) => v.normalizedValue === null) && metric(a, "revenue").adjustments.length === 0);
    check("V03 readiness REVIEW", metric(a, "revenue").integrity?.readiness === "REVIEW");
  }

  // 4 / 5 / 6. Definition tiers.
  {
    const same = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const d = chk(same, "revenue", "definition");
    check("V04 same concept -> PASS, stated as tag-policy match only", d?.status === "PASS" && d.implication.includes("tag-policy match only") && !/equivalent/i.test(d.finding + d.implication), d);
    check("V04 clean pair READY on every metric", same.metrics.every((m) => m.integrity?.readiness === "READY"), same.metrics.map((m) => m.integrity?.readiness));

    const diff = buildAudit(
      co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]),
      co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full, revTag: "RevenueFromContractWithCustomerExcludingAssessedTax" }]),
      2025,
      opts,
    );
    const dd = chk(diff, "revenue", "definition");
    check("V05 different unmapped concepts -> CAUTION, REVIEW (not FAIL/NOT_COMPARABLE)", dd?.status === "CAUTION" && metric(diff, "revenue").integrity?.readiness === "REVIEW" && metric(diff, "revenue").status === "COMPARABLE", dd);
    check("V05 both tags shown and an action given", !!dd && dd.finding.includes("us-gaap:Revenues") && dd.finding.includes("ExcludingAssessedTax") && !!dd.action);
    check("V05 legacy definition check no longer claims equivalence", metric(diff, "revenue").checks.some((c) => c.id === "definition" && !c.passed && c.detail.includes("not established")));
    check("V05 margin inherits the revenue caution", metric(diff, "operating_margin").integrity?.readiness === "REVIEW" && chk(diff, "operating_margin", "definition")?.status === "CAUTION");

    const nci = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full, niTag: "ProfitLoss" }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const n = metric(nci, "net_income");
    check("V06 ProfitLoss vs NetIncomeLoss -> FAIL, BLOCKED, conclusion withheld", chk(nci, "net_income", "definition")?.status === "FAIL" && n.integrity?.readiness === "BLOCKED" && !!n.integrity.withheldConclusionReason && n.integrity.allowableConclusion === null, n.integrity);
    check("V06 legacy status unchanged (PARTIALLY_COMPARABLE)", n.status === "PARTIALLY_COMPARABLE");
    check("V06 raw values still shown", n.values.every((v) => v.reportedValue === 50));
  }

  // 7. Direct versus verified derived value of the same concept: provenance INFO, not a failure.
  {
    const direct: AuditValue = { ticker: "A", reportedValue: 10, normalizedValue: null, display: "$10", currency: "USD", unit: "USD", fiscalYear: 2025, periodEnd: "2025-12-31", periodType: "annual", reportingBasis: "US GAAP (as reported, XBRL)", evidence: [] };
    const derived: AuditValue = { ...direct, ticker: "B", reportedValue: null, normalizedValue: 10, reportingBasis: "Derived from US GAAP inputs" };
    const p = provenanceCheck([direct, derived], []);
    const pass = (id: IntegrityCheck["id"]) => makeCheck({ id, critical: true, status: "PASS", title: id, finding: "", implication: "" });
    check("V07 direct vs derived -> provenance INFO", p.status === "INFO" && p.severity === "informational", p);
    check("V07 READY when every other required check passes", reduceReadiness([pass("evidence"), pass("formula"), pass("definition"), p]) === "READY");
  }

  // 8. Derived formula: zero denominator and non-USD input block the ratio.
  {
    const z = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", rev: 0, oi: -5, ni: -5 }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const m = metric(z, "operating_margin");
    check("V08 zero denominator -> formula FAIL, margin BLOCKED, no value", chk(z, "operating_margin", "formula")?.status === "FAIL" && m.integrity?.readiness === "BLOCKED" && m.values[0].normalizedValue === null, chk(z, "operating_margin", "formula"));
    const fx = buildAudit(co("A", [{ fy: 2025, start: "2025-04-01", end: "2026-03-31", ...full }]), co("TM", [], { nonUsdUnits: { revenue: ["JPY"], operating_income: ["JPY"], net_income: ["JPY"] } }), "latest", opts);
    check("V08 non-USD input -> currency FAIL, margin BLOCKED", chk(fx, "revenue", "currency")?.status === "FAIL" && metric(fx, "operating_margin").integrity?.readiness === "BLOCKED");
    check("V08 non-USD evidence is NOT_ASSESSED, not PASS", chk(fx, "revenue", "evidence")?.status === "NOT_ASSESSED");
    const ok = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", rev: 4000, oi: 400, ni: 1 }]), 2025, opts);
    const f = chk(ok, "operating_margin", "formula");
    check("V08 valid derivation -> formula PASS with both formulas and same canonical definition", f?.status === "PASS" && f.finding.includes("100 / 1000 * 100 = 10.0%") && f.finding.includes("Same canonical formula"), f);
    check("V08 derived values labeled DERIVED", Object.values(metric(ok, "operating_margin").integrity!.sourceBasis).every((b) => b === "DERIVED"));
  }

  // 9. Required SEC structured-data value missing.
  {
    const a = buildAudit(co("NKE", [{ fy: 2025, start: "2024-06-01", end: "2025-05-31", rev: 46e9, ni: 3e9 }]), co("B", [{ fy: 2025, start: "2024-06-01", end: "2025-05-31", ...full }]), 2025, opts);
    const oi = metric(a, "operating_income");
    const ev = chk(a, "operating_income", "evidence");
    check("V09 missing -> INSUFFICIENT_EVIDENCE + BLOCKED, value null (not zero)", oi.status === "INSUFFICIENT_EVIDENCE" && oi.integrity?.readiness === "BLOCKED" && oi.values[0].reportedValue === null);
    check("V09 wording is a data-coverage gap, not a disclosure claim", !!ev && ev.status === "FAIL" && ev.finding.includes("SEC Company Facts") && ev.implication.includes("does not show that the filing omits") && !/does not report/.test(ev.finding), ev);
    check("V09 missing evidence cites no evidence IDs for the missing side", !!ev && ev.evidenceIds.every((id) => !id.startsWith("NKE")));
    check("V09 source basis UNAVAILABLE", oi.integrity?.sourceBasis.NKE === "UNAVAILABLE");
  }

  // 10. Selected XBRL concept changes over time.
  {
    const ys: Year[] = [
      { fy: 2022, start: "2022-01-01", end: "2022-12-31", ...full },
      { fy: 2023, start: "2023-01-01", end: "2023-12-31", ...full },
      { fy: 2024, start: "2024-01-01", end: "2024-12-31", ...full, revTag: "RevenueFromContractWithCustomerExcludingAssessedTax" },
    ];
    const a = buildAudit(co("A", ys), co("B", ys.map((y) => ({ ...y, revTag: undefined }))), 2024, { ...opts, series: [2024, 2023, 2022] });
    const l = chk(a, "revenue", "tag_lineage", "A");
    check("V10 tag change -> tag_lineage CAUTION with both concepts and years", l?.status === "CAUTION" && l.finding.includes("us-gaap:Revenues (FY2022 to FY2023)") && l.finding.includes("RevenueFromContractWithCustomerExcludingAssessedTax (FY2024)"), l);
    check("V10 not asserted as a restatement", !!l && !/restated|restatement occurred/i.test(l.finding) && l.implication.includes("not a restatement"));
    check("V10 trend REVIEW, kept separate from the cross-company definition check", metric(a, "revenue").integrity?.trend?.readiness === "REVIEW" && chk(a, "revenue", "tag_lineage", "B")?.status === "PASS");
  }

  // 11. Single-period audit: multi-year checks NOT_APPLICABLE, no trend.
  {
    const a = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    check("V11 series check NOT_APPLICABLE and trend null", chk(a, "revenue", "series_continuity")?.status === "NOT_APPLICABLE" && metric(a, "revenue").integrity?.trend === null);
    check("V11 coverage lists it as not applicable, not as assessed", metric(a, "revenue").integrity!.coverage.notApplicable.includes("Multi-year consistency") && !metric(a, "revenue").integrity!.coverage.assessed.includes("Multi-year consistency"));
  }

  // 12. Critical check not assessed -> not an unqualified READY; noncritical limits do not block.
  {
    const a = buildAudit(co("A", [{ fy: 2025, end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, end: "2025-12-31", ...full }]), 2025, opts);
    check("V12 unknown period starts -> period_duration NOT_ASSESSED, readiness REVIEW", chk(a, "revenue", "period_duration")?.status === "NOT_ASSESSED" && metric(a, "revenue").integrity?.readiness === "REVIEW");
    const pass = makeCheck({ id: "evidence", critical: true, status: "PASS", title: "e", finding: "", implication: "" });
    const limit = makeCheck({ id: "revisions", critical: false, status: "NOT_ASSESSED", title: "r", finding: "", implication: "" });
    check("V12 noncritical NOT_ASSESSED is a listed limit, READY allowed", reduceReadiness([pass, limit]) === "READY");
    check("V12 without revision metadata, revisions and accounting policy listed as not assessed", metric(a, "revenue").integrity!.coverage.notAssessed.includes("Revisions and restatements") && metric(a, "revenue").integrity!.coverage.notAssessed.includes("Accounting policy and footnotes"));
    check("V12 no PASS without evidence: missing side never passes definition", buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", rev: 1 }]), co("B", []), 2025, opts).metrics[0].integrity!.checks.find((c) => c.id === "definition")?.status === "NOT_ASSESSED");
  }

  // 14. Old audit objects (no V2 fields) still validate, export and parse.
  {
    const a = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const legacy = JSON.parse(JSON.stringify(a)) as ComparabilityAudit;
    delete legacy.integrity;
    for (const m of legacy.metrics) {
      delete m.integrity;
      for (const v of m.values) {
        delete v.sourceBasis;
        delete v.periodStart;
      }
    }
    check("V14 legacy audit validates", validateAudit(legacy).length === 0, validateAudit(legacy));
    const md = auditToMarkdown(legacy);
    check("V14 legacy export works, no V2 section", md.includes("# Comparability audit") && !md.includes("Readiness"));
    const v2md = auditToMarkdown(a);
    check("V14 V2 export adds readiness, checks and coverage", v2md.includes("Readiness: Reliable to compare.") && v2md.includes("**Insufficient evidence**: The available evidence does not support") && v2md.includes("[INFO]") === false && v2md.includes("[PASS] Source evidence") && v2md.includes("Not assessed: Revisions and restatements"), v2md.slice(0, 400));
    const old = toResearchAudit({ status: "completed", auditedPeriod: "FY2025", findings: [{ pair: "A vs B", metricId: "revenue", metric: "Revenue", status: "COMPARABLE", explanation: "x", evidenceUrls: [] }] });
    check("V14 legacy research finding parses without V2 fields", !!old && old.findings[0].readiness === undefined && old.findings[0].checks === undefined);
    const damaged = toResearchAudit({ status: "completed", auditedPeriod: "FY2025", findings: [{ pair: "A vs B", metricId: "revenue", metric: "Revenue", status: "COMPARABLE", explanation: "x", evidenceUrls: [], readiness: "GREAT", checks: [{}] }] });
    check("V14 damaged V2 fields dropped as a whole", !!damaged && damaged.findings[0].readiness === undefined && damaged.findings[0].checks === undefined);
  }

  // 15. The model cannot change a deterministic status or readiness; tampering is rejected by the validator.
  {
    const a = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full, niTag: "ProfitLoss" }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const r = await interpretAudit(a, async () => ({
      metricNotes: [{ metricId: "net_income", note: "Net income is ready to compare." }, { metricId: "net_income", note: "Normalized net income is 48." }],
      overall: "All metrics are READY.",
      readiness: "READY",
    } as never));
    check("V15 model output cannot alter readiness or checks", JSON.stringify(r.audit.metrics.map((m) => m.integrity)) === JSON.stringify(a.metrics.map((m) => m.integrity)));
    check("V15 ungrounded number in a note dropped", !r.audit.metrics[3].aiNotes.some((n) => n.includes("48")));
    const tampered = JSON.parse(JSON.stringify(a)) as ComparabilityAudit;
    tampered.metrics[3].integrity!.readiness = "READY";
    check("V15 upgraded readiness fails validation", validateAudit(tampered).some((e) => e.includes("readiness does not follow")), validateAudit(tampered));
    const sev = JSON.parse(JSON.stringify(a)) as ComparabilityAudit;
    sev.metrics[3].integrity!.checks[0].severity = "informational";
    sev.metrics[3].integrity!.checks.find((c) => c.status === "FAIL")!.severity = "informational";
    check("V15 downgraded severity fails validation", validateAudit(sev).some((e) => e.includes("severity does not match")));
  }

  // 16. Evidence provenance: evidence IDs are real accessions, references are SEC links, nothing synthetic.
  {
    const a = buildAudit(co("A", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), co("B", [{ fy: 2025, start: "2025-01-01", end: "2025-12-31", ...full }]), 2025, opts);
    const all = a.metrics.flatMap((m) => m.integrity!.checks.flatMap((c) => c.evidenceIds));
    check("V16 every check evidence ID is a value's accession", all.length > 0 && all.every((id) => /^[AB]-2025$/.test(id)), [...new Set(all)]);
    const bad = JSON.parse(JSON.stringify(a)) as ComparabilityAudit;
    bad.metrics[0].integrity!.checks[0].evidenceIds = ["FABRICATED"];
    check("V16 fabricated evidence ID fails validation", validateAudit(bad).some((e) => e.includes("cites evidence not in this metric")));
    const ref = JSON.parse(JSON.stringify(a)) as ComparabilityAudit;
    ref.metrics[0].integrity!.checks[0].references = [{ label: "x", url: "https://evil.example/x", accession: "1" }];
    check("V16 non-SEC reference fails validation", validateAudit(ref).some((e) => e.includes("non-SEC reference")));
    check("V16 no quoted excerpt or page claims in findings", a.metrics.every((m) => m.integrity!.checks.every((c) => !/page \d|"[^"]{20,}"/.test(c.finding))));
  }

  // P1. Revision signals from earlier filings of the same concept and period; selection unchanged.
  {
    const mk = (prior: FactRow["priorReports"], value = 263586000) => {
      const d = co("UAA", [{ fy: 2023, start: "2022-04-01", end: "2023-03-31", rev: 5.9e9, oi: value, ni: 1 }]);
      d.metrics.operating_income[0].priorReports = prior;
      for (const m of ["revenue", "net_income"] as const) d.metrics[m][0].priorReports = [];
      return d;
    };
    const peer = co("PEER", [{ fy: 2023, start: "2022-04-01", end: "2023-03-31", ...full }]);
    for (const m of ["revenue", "operating_income", "net_income"] as const) peer.metrics[m][0].priorReports = [];
    const earlier = { accession: "UAA-OLD", filed: "2023-05-24", form: "10-K", value: 283811000, url: "https://www.sec.gov/Archives/UAA/OLD" };

    const a = buildAudit(peer, mk([earlier]), 2023, opts);
    const r = chk(a, "operating_income", "revisions");
    check("P1-1 7% change -> REVISION SIGNAL CAUTION with both values and the delta", r?.status === "CAUTION" && r.finding.includes("REVISION SIGNAL UAA FY2023 operating income: $283.8M") && r.finding.includes("$263.6M") && r.finding.includes("(-7.1%)"), r);
    check("P1-1 not called a restatement; earlier filing referenced", !!r && r.implication.includes("not established") && r.references?.[0].accession === "UAA-OLD");
    check("P1-1 latest value still the one audited (selection unchanged)", metric(a, "operating_income").values[1].reportedValue === 263586000);
    check("P1-1 material signal -> REVIEW; margin inherits it", metric(a, "operating_income").integrity?.readiness === "REVIEW" && chk(a, "operating_margin", "revisions")?.status === "CAUTION");
    check("P1-1 contract validates", validateAudit(a).length === 0, validateAudit(a));

    const small = buildAudit(peer, mk([{ ...earlier, value: 263000000 }]), 2023, opts);
    check("P1-2 <1% change -> INFO, readiness unaffected", chk(small, "operating_income", "revisions")?.status === "INFO" && metric(small, "operating_income").integrity?.readiness === "READY");
    const peerSeen = co("PEER", [{ fy: 2023, start: "2022-04-01", end: "2023-03-31", ...full }]);
    for (const m of ["revenue", "operating_income", "net_income"] as const) peerSeen.metrics[m][0].priorReports = [{ ...earlier, accession: "PEER-OLD", value: peerSeen.metrics[m][0].value }];
    const same = buildAudit(peerSeen, mk([{ ...earlier, value: 263586000 }]), 2023, opts);
    check("P1-3 same value in earlier filings for both -> PASS", chk(same, "operating_income", "revisions")?.status === "PASS" && chk(same, "operating_income", "revisions")!.finding.includes("UAA (1 earlier filing)"), chk(same, "operating_income", "revisions"));
    check("P1-3 one company without candidates -> partly NOT_ASSESSED", chk(buildAudit(peer, mk([{ ...earlier, value: 263586000 }]), 2023, opts), "operating_income", "revisions")?.status === "NOT_ASSESSED");
    const none = buildAudit(peer, mk([]), 2023, opts);
    check("P1-4 no earlier candidate -> NOT_ASSESSED, never 'no revisions'", chk(none, "revenue", "revisions")?.status === "NOT_ASSESSED" && chk(none, "revenue", "revisions")!.implication.includes("not a finding of no revisions"));

    const usGaap = {
      OperatingIncomeLoss: {
        units: {
          USD: [
            { start: "2022-04-01", end: "2023-03-31", val: 263586000, accn: "NEW", fy: 2025, fp: "FY", form: "10-K", filed: "2025-05-22" },
            { start: "2022-04-01", end: "2023-03-31", val: 283811000, accn: "OLD", fy: 2023, fp: "FY", form: "10-K", filed: "2023-05-24" },
            { start: "2022-04-01", end: "2023-03-31", val: 270000000, accn: "LATER", fy: 2026, fp: "FY", form: "10-K", filed: "2026-05-19" },
            { start: "2022-04-01", end: "2022-12-31", val: 1, accn: "OLD", fy: 2023, fp: "Q3", form: "10-K", filed: "2023-05-24" },
            { start: "2022-04-01", end: "2023-03-31", val: 1, accn: "Q", fy: 2023, fp: "FY", form: "8-K", filed: "2023-05-01" },
          ],
        },
      },
    };
    const rows = { revenue: [], net_income: [], operating_income: [{ fiscalYear: 2023, periodEnd: "2023-03-31", value: 263586000, form: "10-K", filed: "2025-05-22", tag: "OperatingIncomeLoss", citationKey: "NEW" }] };
    const meta = periodMetadata(usGaap, rows, 1336917);
    const pr = meta.metrics.operating_income[0].priorReports ?? [];
    check("P1-5 candidates: same concept + exact period + annual form + filed earlier only", pr.length === 1 && pr[0].accession === "OLD" && pr[0].value === 283811000 && pr[0].url.startsWith("https://www.sec.gov/"), pr);
  }

  // Research summary: readiness, conclusions and trend reach the panel; overall verdict on the audit.
  {
    const nke = co("NKE", [2024, 2025, 2026].map((y) => ({ fy: y, start: `${y - 1}-06-01`, end: `${y}-05-31`, rev: 50e9, ni: 5e9 })));
    const uaa = co("UAA", [
      { fy: 2024, start: "2023-04-01", end: "2024-03-31", rev: 5e9, oi: 1e8, ni: 1e8 },
      { fy: 2025, start: "2024-04-01", end: "2025-03-31", rev: 5e9, oi: 1e8, ni: 1e8 },
      { fy: 2026, start: "2025-04-01", end: "2026-03-31", rev: 5e9, oi: 1e8, ni: 1e8 },
    ]);
    const plan: ResearchAuditPlan = { tickers: ["NKE", "UAA"], metrics: ["revenue", "operating_income", "operating_margin", "net_income"], uncheckedMetrics: [], period: 2026, multiYear: true, yearsInResearch: [2026, 2025, 2024] };
    const audit = buildAudit(nke, uaa, 2026, { ...opts, series: plan.yearsInResearch });
    const s = summarize(plan, [audit]);
    const rev = s.findings.find((f) => f.metricId === "revenue")!;
    const oi = s.findings.find((f) => f.metricId === "operating_income")!;
    check("RV1 revenue READY with INFO timing; operating income BLOCKED with withheld conclusion", rev.readiness === "READY" && rev.checks?.some((c) => c.status === "INFO") === true && oi.readiness === "BLOCKED" && /not supported/.test(oi.conclusion ?? ""), { rev, oi });
    check("RV1 trend summarized for multi-year research", rev.trend?.readiness === "READY" && oi.trend?.readiness === "BLOCKED");
    check("RV1 summary round-trips through the tolerant reader", JSON.stringify(toResearchAudit(JSON.parse(JSON.stringify(s)))?.findings) === JSON.stringify(s.findings));
    check("RV1 limitation says series was checked but growth math was not", s.limitations.some((l) => l.includes("only FY2026 was audited") && l.includes("growth-rate calculations themselves were not re-verified")));
    check("RV1 audit-level verdict uses the shared display labels", audit.integrity!.verdict.startsWith("Reliable to compare: revenue, net income. Insufficient evidence: operating income, operating margin."), audit.integrity?.verdict);
    const serialized = [...JSON.stringify(s).matchAll(/"readiness":"([^"]+)"/g)].map((m) => m[1]);
    check(
      "RV1 internal readiness enum unchanged in data and serialization (labels are display-only)",
      JSON.stringify(audit.integrity!.readinessByMetric) === JSON.stringify({ revenue: "READY", operating_income: "BLOCKED", operating_margin: "BLOCKED", net_income: "READY" }) &&
        serialized.length > 0 && serialized.every((r) => ["READY", "REVIEW", "BLOCKED"].includes(r)),
      serialized,
    );
    check("RV1 analyst actions added to the checklist", audit.reviewChecklist.some((c) => c.startsWith("Operating income: Locate the figure")));
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
