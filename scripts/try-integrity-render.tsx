// Offline render smoke of the V2 integrity UI (research panel and /audit result), with V2 and pre-V2 objects.
// Run: npx tsx scripts/try-integrity-render.tsx   (no react-server condition: these are client components)
import { renderToStaticMarkup } from "react-dom/server";
import { AuditResult } from "../components/audit/audit-workspace";
import { ComparabilityCautions } from "../components/research/comparability-cautions";
import { applyEvent, newTurn, turnView, updateTurn } from "../components/research/conversation";
import { TurnResult } from "../components/research/turn-result";
import type { AgentResult } from "../lib/agent/types";
import { READINESS_EXPLANATION, READINESS_LABEL } from "../lib/audit/report";
import { buildAudit, type CompanyData, type FactRow } from "../lib/audit/engine";
import { planResearchAudit, summarize, type ResearchAuditPlan } from "../lib/audit/research";
import { parsePersistedRun } from "../lib/history-parse";
import { toResearchAudit, type ComparabilityAudit } from "../lib/audit/types";

let failures = 0;
const rendered: Record<string, string> = {};
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${String(detail).slice(0, 500)}`}`);
}

const row = (fy: number, start: string, end: string, value: number, acc: string, tag: string): FactRow => ({ fiscalYear: fy, periodStart: start, periodEnd: end, value, form: "10-K", filed: "2026-06-01", tag, citationKey: acc });
function co(ticker: string, start: string, end: string, oi: boolean): CompanyData {
  const acc = `${ticker}-ACC`;
  return {
    company: { ticker, name: `${ticker} Inc.`, cik: 1 },
    metrics: {
      revenue: [row(2026, start, end, 5e9, acc, "Revenues")],
      operating_income: oi ? [row(2026, start, end, 5e8, acc, "OperatingIncomeLoss")] : [],
      net_income: [row(2026, start, end, 3e8, acc, "NetIncomeLoss")],
    },
    nonUsdUnits: {},
    filings: { [acc]: { url: `https://www.sec.gov/Archives/${ticker}`, form: "10-K", filed: "2026-06-01" } },
  };
}
const audit = buildAudit(co("NKE", "2025-06-01", "2026-05-31", false), co("UAA", "2025-04-01", "2026-03-31", true), 2026, { auditId: "r", now: new Date("2026-10-21T00:00:00Z") });
const plan: ResearchAuditPlan = { tickers: ["NKE", "UAA"], metrics: ["revenue", "operating_income", "operating_margin", "net_income"], uncheckedMetrics: ["Growth rates"], period: 2026, multiYear: false, yearsInResearch: [2026] };
const summary = summarize(plan, [audit]);

const panel = renderToStaticMarkup(<ComparabilityCautions audit={summary} />);
rendered["V2 panel (blocked + ready)"] = panel;
check("P1 V2 panel title and explanatory subtitle", panel.includes("Financial Comparison Integrity") && panel.includes("Checks whether financial figures are suitable for comparison based on reporting periods, source data, accounting concepts, and calculation consistency."));
const text = (html: string) => html.replace(/<span class="sr-only">.*?<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");
const pt = text(panel);
check("P1 OI and margin grouped as one unsupported entry", /Insufficient evidence Operating income · Operating margin Comparison not supported\. The available evidence does not support/.test(pt), pt);
check("P1 missing evidence named once (deduplicated across OI and margin)", pt.split("no us-gaap OperatingIncomeLoss fact").length - 1 === 1, pt);
check("P1 next step and SEC link on the unsupported entry", pt.includes("Next step: Locate the figure in the 10-K itself") && panel.includes("SEC filing 1"));
check("P1 revenue and net income grouped as reliable, with the INFO timing disclosure", /Reliable to compare Revenue · Net income Available checks support this comparison\. Unassessed accounting differences may still exist\. Fiscal years end 61 days apart/.test(pt), pt);
check("P1 INFO shown with the info icon, not a check mark or caution", panel.includes('<span class="sr-only">Info, Fiscal period alignment: </span>'));
check("P1 old wording gone", !/Do not rely|>Ready<|>Blocked<|>Review</.test(panel));
check("P1 states the answer is not edited by the review", pt.includes("Run after the answer above was written; the answer is not edited."));
check("P1 badge tooltips carry the state explanations", panel.includes(`title="${READINESS_EXPLANATION.BLOCKED}"`) && panel.includes(`title="${READINESS_EXPLANATION.READY}"`));
check("P1 coverage: checked metrics and accounting-policy limit stated", pt.includes("Checked: revenue, operating income, operating margin, net income. Not audited: growth rates, accounting-policy and footnote equivalence."), pt);
check("P1 comparability status and source basis kept, in the disclosure", pt.includes("Operating margin: comparability insufficient evidence · NKE unavailable · UAA derived") && pt.includes("Revenue: comparability comparable · NKE reported · UAA reported"), pt);
check("P1 crisper: under 260 words", pt.split(" ").filter(Boolean).length < 260, pt.split(" ").length);

const legacySummary = toResearchAudit({ status: "partial", auditedPeriod: "FY2024", companies: ["NKE", "UAA"], periodDetails: [], checkedMetrics: ["Revenue"], uncheckedMetrics: [], limitations: [], findings: [{ pair: "NKE vs UAA", metricId: "revenue", metric: "Revenue", status: "PARTIALLY_COMPARABLE", explanation: "Fiscal years end 61 days apart.", evidenceUrls: ["https://www.sec.gov/x"] }] })!;
const legacyPanel = renderToStaticMarkup(<ComparabilityCautions audit={legacySummary} />);
rendered["legacy panel"] = legacyPanel;
check("P2 saved pre-V2 summary renders the earlier view", legacyPanel.includes("Comparability cautions") && legacyPanel.includes("Partially comparable") && !legacyPanel.includes("Readiness") && !legacyPanel.includes("Do not rely"));

const result = renderToStaticMarkup(<AuditResult audit={audit} />);
rendered["/audit result"] = result;
check("P3 /audit shows the integrity title, subtitle and labeled verdict", result.includes("Financial Comparison Integrity") && result.includes("calculation consistency") && result.includes("Insufficient evidence: operating income, operating margin."), result.slice(0, 300));
check("P3 blocked metric: comparison not supported, with the state explanation", result.includes("Comparison not supported.") && result.includes(READINESS_EXPLANATION.BLOCKED));
check("P3 old wording gone from /audit", !/Decision readiness|Conclusion withheld|>Ready<|>Blocked</.test(result));
check("P3 not-assessed checks rendered without a check mark label", result.includes("Not assessed") && result.includes("Coverage limits"));
check("P3 period window and concept shown", result.includes("2025-06-01 to 2026-05-31") && result.includes("us-gaap:Revenues"));

const legacy = JSON.parse(JSON.stringify(audit)) as ComparabilityAudit;
delete legacy.integrity;
for (const m of legacy.metrics) delete m.integrity;
const legacyResult = renderToStaticMarkup(<AuditResult audit={legacy} />);
rendered["legacy /audit result"] = legacyResult;
check("P4 pre-V2 audit object renders with legacy checks", legacyResult.includes("Metric review") && !legacyResult.includes("Financial Comparison Integrity") && legacyResult.includes("currency:"));

// All three states with labels and explanations, mixed in one panel.
{
  const lulu = buildAudit(co("NKE", "2023-06-01", "2024-05-31", true), co("LULU", "2023-01-30", "2024-01-28", true), 2026, { auditId: "m", now: new Date("2026-10-21T00:00:00Z") });
  const mixed = summarize({ ...plan, tickers: ["NKE", "LULU"] }, [lulu, audit]);
  const html = renderToStaticMarkup(<ComparabilityCautions audit={mixed} />);
  rendered["mixed panel (all three states)"] = html;
  const states = new Set(mixed.findings.map((f) => f.readiness));
  check("P5 mixed fixture has all three internal states", states.size === 3, [...states]);
  for (const r of ["READY", "REVIEW", "BLOCKED"] as const) {
    check(`P5 ${r} -> "${READINESS_LABEL[r]}" with its explanation`, html.includes(`>${READINESS_LABEL[r]}<`) && html.includes(READINESS_EXPLANATION[r]));
  }
  check("P5 caution entry lists its qualifying finding", /Compare with caution [^.]*Operating income[\s\S]*Fiscal years end 124 days apart/.test(text(html)), text(html));
}

// Multi-year: trend findings appear once, apart from the audited year, and not for already-unsupported metrics.
{
  const series = [2024, 2025, 2026];
  const mk = (t: string, start: (y: number) => string, end: (y: number) => string, tag: (y: number) => string): CompanyData => {
    const d = co(t, start(2026), end(2026), true);
    d.metrics.revenue = series.map((y) => ({ ...row(y, start(y), end(y), 5e9, `${t}-ACC`, tag(y)) }));
    d.metrics.net_income = series.map((y) => ({ ...row(y, start(y), end(y), 3e8, `${t}-ACC`, "NetIncomeLoss") }));
    d.metrics.operating_income = [];
    return d;
  };
  const a = mk("AAA", (y) => `${y - 1}-06-01`, (y) => `${y}-05-31`, () => "Revenues");
  const b = mk("BBB", (y) => `${y - 1}-04-01`, (y) => `${y}-03-31`, (y) => (y < 2026 ? "Revenues" : "RevenueFromContractWithCustomerExcludingAssessedTax"));
  b.metrics.revenue = b.metrics.revenue.filter((r) => r.fiscalYear !== 2025);
  b.metrics.net_income = b.metrics.net_income.filter((r) => r.fiscalYear !== 2025);
  const ma = buildAudit(a, b, 2026, { auditId: "y", now: new Date("2026-10-21T00:00:00Z"), series });
  const s2 = summarize({ ...plan, tickers: ["AAA", "BBB"], multiYear: true, yearsInResearch: [2026, 2025, 2024] }, [ma]);
  rendered["multi-year panel"] = renderToStaticMarkup(<ComparabilityCautions audit={s2} />);
  const t2 = text(rendered["multi-year panel"]);
  const trendAt = t2.indexOf("Multi-year trend (separate from the audited year)");
  check("T1 trend block present, after the audited-year entries", trendAt > t2.indexOf("Net income"), t2);
  check("T1 series break explained once, in the trend block only", t2.split("FY2025 not in the annual series").length - 1 === 1 && t2.indexOf("FY2025 not in the annual series") > trendAt, t2);
  check("T1 concept change kept in the trend block", t2.indexOf("then us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax") > trendAt);
  check("T1 a finding for only some metrics names them", t2.includes("RevenueFromContractWithCustomerExcludingAssessedTax (FY2026). (Revenue)"), t2.slice(trendAt));
  check("T1 unsupported metrics (operating income) not repeated in the trend block", !t2.slice(trendAt).includes("Operating income"), t2.slice(trendAt));
}

// Order and ownership: the complete answer first, its own review after it, once.
const answerResult: AgentResult = {
  status: "success",
  trace: [],
  answer: {
    kind: "answer",
    answerMarkdown: "Nike is larger by revenue [1].",
    tables: [{ title: "Revenue table", columns: ["Fiscal year", "NKE", "UAA"], rows: [["FY2026", "$46.40B [1]", "$4.97B [1]"]] }],
    sources: [{ n: 1, type: "filing", company: "NIKE", ticker: "NKE", form: "10-K", fiscalYear: 2026, periodEnd: "2026-05-31", filed: "2026-07-20", accession: "A", url: "https://www.sec.gov/a" }],
    followUps: ["What about margins?"],
    notes: [],
  },
};
const order = (html: string, ...needles: string[]) => needles.map((n) => html.indexOf(n));
const asc = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));
{
  const html = renderToStaticMarkup(<TurnResult result={answerResult} audit={summary} onAsk={() => {}} />);
  rendered["answer + panel"] = html;
  const pos = order(html, "Nike is larger by revenue", "Revenue table", "https://www.sec.gov/a", "What about margins?", "Financial Comparison Integrity");
  check("O1 prose, table, citations and follow-ups all render before the integrity panel", asc(pos), pos);
  check("O1 exactly one panel", html.split('aria-label="Financial comparison integrity"').length - 1 === 1);
  const none = renderToStaticMarkup(<TurnResult result={answerResult} audit={null} />);
  check("O2 no audit -> answer only, no panel", none.includes("Revenue table") && !none.includes("Comparison Integrity") && !none.includes("Comparability"));
  const unavailable = renderToStaticMarkup(<TurnResult result={answerResult} audit={{ ...summary, status: "unavailable", findings: [] }} />);
  const up = order(unavailable, "Revenue table", "review unavailable");
  check("O3 unavailable review still below the answer", asc(up), up);
}

// Live turn: the panel shows only once the validated answer is visible, and stays with its own turn.
{
  let a = newTurn("a", "Compare NKE and UAA");
  a = applyEvent(a, { type: "answer_delta", text: "Nike is" });
  check("O4 while streaming the draft, no result is visible (panel gated on the result)", !turnView(a).resultVisible);
  a = applyEvent(a, { type: "audit", audit: summary });
  check("O4 audit arriving early is held, not shown, until the result is visible", a.audit !== null && !turnView(a).resultVisible);
  a = applyEvent(a, { type: "final", result: answerResult });
  a = { ...a, draftDone: true };
  check("O4 after final and drain, result visible with its audit", turnView(a).resultVisible && JSON.stringify(a.audit) === JSON.stringify(summary));

  let turns = [a, newTurn("b", "And Lululemon?")];
  turns = updateTurn(turns, "b", (t) => applyEvent(applyEvent(t, { type: "final", result: answerResult }), { type: "audit", audit: { ...summary, auditedPeriod: "FY2025" } }));
  const htmlA = renderToStaticMarkup(<TurnResult result={turns[0].result!} audit={turns[0].audit} />);
  const htmlB = renderToStaticMarkup(<TurnResult result={turns[1].result!} audit={turns[1].audit} />);
  check("O5 follow-up's audit attaches to its own turn; the earlier panel is unchanged", JSON.stringify(turns[0].audit) === JSON.stringify(a.audit) && turns[0] === a && htmlA.includes("Audited period: FY2026") && htmlB.includes("Audited period: FY2025") && !htmlA.includes("FY2025<"));
}

// Reload / history: a saved run restores the same answer-then-panel order.
{
  const restored = parsePersistedRun({ steps: [], answer: answerResult.answer, audit: JSON.parse(JSON.stringify(summary)) }, "x", "success");
  const html = renderToStaticMarkup(<TurnResult result={{ status: "success", answer: restored.answer!, trace: restored.steps }} audit={restored.audit} />);
  const pos = order(html, "Revenue table", "Financial Comparison Integrity", "Insufficient evidence");
  check("O6 reloaded run: answer then panel, readiness labels restored", restored.audit?.findings[0].readiness === "READY" && asc(pos), pos);
  const old = parsePersistedRun({ steps: [], answer: answerResult.answer }, "x", "success");
  check("O6 older saved run without an audit shows no panel", !renderToStaticMarkup(<TurnResult result={{ status: "success", answer: old.answer!, trace: [] }} audit={old.audit} />).includes("Comparab"));
}

// Ineligible research never gets a review to show.
{
  const single: AgentResult = { ...answerResult, trace: [{ type: "action", iteration: 1, id: "t1", tool: "get_financials", label: "", input: { thought: "", ticker: "NKE", metrics: ["revenue"], years: 5 } }, { type: "observation", iteration: 1, id: "t1", tool: "get_financials", ok: true, summary: "" }] };
  check("O7 single-company research is not audited (no panel)", planResearchAudit(single) === null);
}

// Invalid nesting (a block element inside <p>) is a React hydration error in the browser; catch it here.
function blockInsideP(html: string): string | null {
  const BLOCK = /^(div|ul|ol|li|dl|section|details|table|h[1-6]|p|aside|header|footer|article)$/;
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>/g)) {
    const [, close, tag, selfClose] = m;
    if (tag === "p") {
      if (close) depth = Math.max(0, depth - 1);
      else if (depth > 0) return `<p> inside <p> near ${m.index}`;
      else if (!selfClose) depth++;
    } else if (!close && depth > 0 && BLOCK.test(tag)) return `<${tag}> inside <p>: ${html.slice(Math.max(0, m.index! - 120), m.index! + 40)}`;
  }
  return null;
}
for (const [name, html] of Object.entries(rendered)) {
  const bad = blockInsideP(html);
  check(`N1 valid nesting: ${name}`, bad === null, bad);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
if (failures) process.exit(1);
