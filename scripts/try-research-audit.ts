// Offline (no SEC, no LLM, no database): comparability enrichment of research answers (lib/audit/research.ts),
// its stream event, persistence parsing and per-turn client state.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-research-audit.ts
import { applyEvent, newTurn, updateTurn } from "../components/research/conversation";
import { createAgentStream, type RunRecord } from "../lib/agent/runStream";
import type { AgentEvent, AgentResult, AnswerTable, TraceStep } from "../lib/agent/types";
import type { CompanyData, FactRow } from "../lib/audit/engine";
import { planResearchAudit, runResearchAudit } from "../lib/audit/research";
import { parsePersistedRun } from "../lib/history-parse";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

let n = 0;
function fin(ticker: string, metrics: string[], years = 5): TraceStep[] {
  const id = `t${++n}`;
  return [
    { type: "action", iteration: 1, id, tool: "get_financials", label: "", input: { thought: "", ticker, metrics, years } },
    { type: "observation", iteration: 1, id, tool: "get_financials", ok: true, summary: "" },
  ];
}
function calc(labels: string[]): TraceStep[] {
  const id = `t${++n}`;
  return [
    { type: "action", iteration: 2, id, tool: "calculate", label: "", input: { thought: "", calculations: labels.map((label) => ({ label, expression: "1" })) } },
    { type: "observation", iteration: 2, id, tool: "calculate", ok: true, summary: "" },
  ];
}
function result(trace: TraceStep[], tables: AnswerTable[] = [], kind: AgentResult["answer"]["kind"] = "answer"): AgentResult {
  return {
    status: kind === "answer" ? "success" : "failed",
    trace,
    answer: {
      kind,
      answerMarkdown: "Nike is larger [1].",
      tables,
      sources: [{ n: 1, type: "filing", company: "NIKE", ticker: "NKE", form: "10-K", fiscalYear: 2024, periodEnd: "2024-05-31", filed: "2024-07-25", accession: "A", url: "https://www.sec.gov/a" }],
      followUps: ["What about margins?"],
      notes: [],
    },
  };
}
const table = (years: string[]): AnswerTable => ({ title: "Revenue", columns: ["Fiscal year", "NKE", "UAA"], rows: years.map((y) => [y, "$1B [1]", "$1B [1]"]) });

const row = (fy: number, end: string, value: number, acc: string, tag: string): FactRow => ({ fiscalYear: fy, periodEnd: end, value, form: "10-K", filed: "2025-01-01", tag, citationKey: acc });
function co(ticker: string, years: { fy: number; end: string; rev: number; oi?: number; ni: number }[]): CompanyData {
  const acc = `${ticker}-ACC`;
  return {
    company: { ticker, name: `${ticker} Inc.`, cik: 1 },
    metrics: {
      revenue: years.map((y) => row(y.fy, y.end, y.rev, acc, "Revenues")),
      operating_income: years.filter((y) => y.oi !== undefined).map((y) => row(y.fy, y.end, y.oi!, acc, "OperatingIncomeLoss")),
      net_income: years.map((y) => row(y.fy, y.end, y.ni, acc, "NetIncomeLoss")),
    },
    nonUsdUnits: {},
    filings: { [acc]: { url: `https://www.sec.gov/${ticker}`, form: "10-K", filed: "2025-01-01" } },
  };
}
const DATA: Record<string, CompanyData> = {
  NKE: co("NKE", [
    { fy: 2024, end: "2024-05-31", rev: 51e9, ni: 5.7e9 },
    { fy: 2023, end: "2023-05-31", rev: 51.2e9, ni: 5.1e9 },
  ]),
  UAA: co("UAA", [
    { fy: 2024, end: "2024-03-31", rev: 5.7e9, oi: 2e8, ni: 2.3e8 },
    { fy: 2023, end: "2023-03-31", rev: 5.9e9, oi: 2.7e8, ni: 3.9e8 },
  ]),
  KO: co("KO", [{ fy: 2025, end: "2025-12-31", rev: 48e9, oi: 13.7e9, ni: 13e9 }]),
  PEP: co("PEP", [{ fy: 2025, end: "2025-12-27", rev: 94e9, oi: 11.5e9, ni: 8.2e9 }]),
};
const fetchFake = async (t: string) => DATA[t];

async function readStream(stream: ReadableStream<Uint8Array>): Promise<AgentEvent[]> {
  const text = await new Response(stream).text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

async function main() {
  const NKE_UAA = [...fin("NKE", ["revenue", "operating_income", "net_income", "gross_profit"]), ...fin("UAA", ["revenue", "operating_income", "net_income", "gross_profit"]), ...calc(["NKE FY2024 revenue growth %", "UAA FY2024 gross margin %", "UAA FY2024 operating margin %"])];

  // 1 / 2: trigger
  const plan = planResearchAudit(result(NKE_UAA, [table(["FY2024 (ended 2024-05-31)"])]));
  check("R01 two-company comparison triggers an audit", plan !== null && plan.tickers.join() === "NKE,UAA", plan);
  check("R02 single-company research does not trigger", planResearchAudit(result(fin("NKE", ["revenue"]))) === null);
  check("R02 non-answer kinds do not trigger", planResearchAudit(result(NKE_UAA, [], "insufficient_data")) === null);
  check("R02 failed get_financials does not count as a company", planResearchAudit(result([...fin("NKE", ["revenue"]), { type: "action", iteration: 1, id: "x", tool: "get_financials", label: "", input: { ticker: "UAA", metrics: ["revenue"], years: 5 } }, { type: "observation", iteration: 1, id: "x", tool: "get_financials", ok: false, summary: "err" }])) === null);
  check("R02 only unsupported metrics -> no audit", planResearchAudit(result([...fin("NKE", ["inventory"]), ...fin("UAA", ["inventory"])])) === null);

  // 3: unsupported metrics
  check("R03 relevant supported metrics", plan?.metrics.join() === "revenue,operating_income,operating_margin,net_income", plan?.metrics);
  check("R03 unsupported metrics listed as unaudited", !!plan && ["Gross profit", "Growth rates", "Gross margin"].every((m) => plan.uncheckedMetrics.includes(m)), plan?.uncheckedMetrics);
  check("R03 operating margin calc not listed as unaudited", !plan?.uncheckedMetrics.some((m) => /operating/i.test(m)));

  // 4 / 5: periods
  const hist = planResearchAudit(result(NKE_UAA, [table(["FY2022", "FY2021"])]));
  check("R04 historical research audits the year it shows, not latest", hist?.period === 2022, hist);
  const multi = planResearchAudit(result(NKE_UAA, [table(["FY2024 (ended 2024-05-31)", "FY2023 (ended 2023-05-31)", "2022"])]));
  check("R05 multi-year research flagged, most recent year audited", multi?.multiYear === true && multi.period === 2024 && multi.yearsInResearch.join() === "2024,2023,2022", multi);
  const noYears = planResearchAudit(result(NKE_UAA));
  check("R05 no years shown but 5 fetched -> latest, multi-year", noYears?.period === "latest" && noYears.multiYear === true, noYears);

  const r = result(NKE_UAA, [table(["FY2024 (ended 2024-05-31)", "FY2023 (ended 2023-05-31)"])]);
  const before = JSON.stringify(r);
  const summary = await runResearchAudit(r, fetchFake);
  check("R05 summary says only FY2024 was audited", !!summary && summary.auditedPeriod === "FY2024" && summary.limitations.some((l) => l.includes("FY2023") && l.includes("only FY2024 was audited")), summary?.limitations);

  // 6: missing evidence -> caution
  const oi = summary?.findings.find((f) => f.metricId === "operating_income");
  check("R06 missing Nike operating income -> INSUFFICIENT_EVIDENCE caution", oi?.status === "INSUFFICIENT_EVIDENCE" && oi.explanation.includes("NKE") && summary?.status === "partial", oi);
  const rev = summary?.findings.find((f) => f.metricId === "revenue");
  // V2: two full annual periods 61 days apart are an ordinary fiscal-calendar difference (INFO, disclosed), not a
  // partial comparison. Was PARTIALLY_COMPARABLE before V2.
  check(
    "R06 61-day fiscal year-end gap is disclosed as INFO timing, still comparable, with SEC evidence",
    rev?.status === "COMPARABLE" && rev.explanation.includes("days apart") && rev.checks?.some((c) => c.id === "period_alignment" && c.status === "INFO") === true && rev.evidenceUrls.every((u) => u.startsWith("https://www.sec.gov/")),
    rev,
  );
  check("R06 period details explicit", summary?.periodDetails[0] === "NKE FY2024 (ended 2024-05-31) vs UAA FY2024 (ended 2024-03-31)", summary?.periodDetails);

  // 8 / 9: never alters the answer
  check("R08 audit leaves the research result byte-identical (figures, tables, citations)", JSON.stringify(r) === before);

  const clean = await runResearchAudit(result([...fin("KO", ["revenue", "operating_income", "net_income"]), ...fin("PEP", ["revenue", "operating_income", "net_income"])], [table(["FY2025"])]), fetchFake);
  check("R06 clean pair -> completed, all comparable", clean?.status === "completed" && clean.findings.every((f) => f.status === "COMPARABLE") && clean.findings.length === 4, clean);

  // 3 companies: anchor vs each other
  const three = await runResearchAudit(result([...fin("KO", ["revenue"]), ...fin("PEP", ["revenue"]), ...fin("NKE", ["revenue"])], [table(["FY2025"])]), fetchFake);
  check("R01 three companies -> two pairs against the anchor", [...new Set(three?.findings.map((f) => f.pair))].join() === "KO vs PEP,KO vs NKE", three?.findings.map((f) => f.pair));

  // 4b: newest year shown exists for only one company -> newest common year is audited and labeled
  const onlyB = await runResearchAudit(result([...fin("UAA", ["revenue", "net_income"]), ...fin("NKE", ["revenue", "net_income"])], [table(["FY2025", "FY2024", "FY2023"])]), async (t) =>
    t === "UAA" ? co("UAA", [{ fy: 2025, end: "2025-03-31", rev: 5e9, ni: 1e8 }, { fy: 2024, end: "2024-03-31", rev: 5.7e9, ni: 2.3e8 }]) : DATA[t]);
  check("R04b newest common year audited when the newest shown is missing for one company", onlyB?.auditedPeriod === "FY2024" && onlyB.findings.find((f) => f.metricId === "revenue")?.status !== "INSUFFICIENT_EVIDENCE" && onlyB.limitations.some((l) => l.includes("FY2025")), onlyB);

  // 7: failure modes
  const failed = await runResearchAudit(r, async () => { throw new Error("SEC down"); });
  check("R07 retrieval failure -> 'unavailable' summary, no findings", failed?.status === "unavailable" && failed.findings.length === 0, failed);
  const slow = await runResearchAudit(r, () => new Promise(() => {}), { timeoutMs: 50 });
  check("R07 hung retrieval -> unavailable within the timeout", slow?.status === "unavailable");

  // 10 / 7 / 14: stream order, persistence, status unchanged
  async function stream(audit: (res: AgentResult) => Promise<unknown>, res: AgentResult = r) {
    const saved: RunRecord[] = [];
    const events = await readStream(
      createAgentStream("q", {
        run: async (_q, onStep, _s, onDelta) => {
          onStep(res.trace[0]);
          onDelta("Nike is");
          return res;
        },
        save: async (rec) => void saved.push(rec),
        audit: audit as never,
      }),
    );
    return { events, saved };
  }
  const s1 = await stream((res) => runResearchAudit(res, fetchFake));
  check("R10 event order: step, answer_delta, final, audit", s1.events.map((e) => e.type).join() === "step,answer_delta,final,audit", s1.events.map((e) => e.type));
  const finalEv = s1.events.find((e) => e.type === "final") as Extract<AgentEvent, { type: "final" }>;
  check("R09 final event carries the unchanged result (citations intact)", JSON.stringify(finalEv.result) === before);
  check("R12 audit saved inside runs.trace, status unchanged", (s1.saved[0].trace as { audit?: { status: string } }).audit?.status === "partial" && s1.saved[0].status === "success");

  const s2 = await stream(async () => { throw new Error("boom"); });
  check("R07 audit throwing still streams final, saves the run, no audit event", s2.events.map((e) => e.type).join() === "step,answer_delta,final" && s2.saved.length === 1 && !("audit" in (s2.saved[0].trace as object)), s2.events.map((e) => e.type));
  const failedRun = result(NKE_UAA, [], "insufficient_data");
  const s3 = await stream((res) => runResearchAudit(res, fetchFake), failedRun);
  check("R14 non-answer: no audit, still saved as failed (usage unchanged)", !s3.events.some((e) => e.type === "audit") && s3.saved[0].status === "failed");

  // 12: persistence parsing
  const savedTrace = s1.saved[0].trace;
  check("R12 saved audit reloads", parsePersistedRun(savedTrace, "x", "success").audit?.findings.length === 4);
  check("R12 older run without audit -> none (nothing fabricated)", parsePersistedRun({ steps: [], answer: r.answer }, "x", "success").audit === null);
  check("R12 malformed audit -> none", parsePersistedRun({ steps: [], answer: r.answer, audit: { status: "bogus" } }, "x", "success").audit === null);
  check("R12 legacy text-only run -> none", parsePersistedRun(null, "text", "success").audit === null);
  const tampered = parsePersistedRun({ steps: [], answer: r.answer, audit: { ...(savedTrace as { audit: object }).audit, findings: [{ metricId: "revenue", metric: "Revenue", status: "COMPARABLE", explanation: "x", evidenceUrls: ["javascript:alert(1)"] }] } }, "x", "success");
  check("R12 non-SEC evidence URLs dropped on reload", tampered.audit?.findings[0].evidenceUrls.length === 0);

  // 11: per-turn client state
  const a = newTurn("a", "Compare NKE and UAA");
  const b = newTurn("b", "And margins?");
  let turns = [a, b];
  turns = updateTurn(turns, "b", (t) => applyEvent(t, { type: "audit", audit: summary! }));
  check("R11 audit event touches only its own turn", turns[0] === a && turns[1].audit?.status === "partial" && turns[1].result === null);
  turns = updateTurn(turns, "b", (t) => applyEvent(t, finalEv));
  check("R11 final after audit keeps both", turns[1].audit !== null && turns[1].result !== null);

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
