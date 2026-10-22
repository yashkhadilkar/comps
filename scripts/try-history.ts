// Offline checks for Research History parsing, labels and grouping (lib/history-parse.ts).
import { groupByDay, parsePersistedRun, statusLabel } from "../lib/history-parse";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

const answer = {
  kind: "answer",
  answerMarkdown: "Nike margin 44% [1]",
  tables: [{ title: "Gross margin", columns: ["FY", "NKE"], rows: [["FY2024", "44.6%"]] }],
  sources: [
    { n: 1, type: "filing", company: "Nike", ticker: "NKE", form: "10-K", fiscalYear: 2024, periodEnd: "2024-05-31", filed: "2024-07-25", accession: "a", url: "https://www.sec.gov/x" },
    { n: 2, type: "news", title: "t", url: "javascript:alert(1)", publishedDate: null, domain: "x.com" },
  ],
  followUps: ["Q1", 5],
  notes: ["n1"],
};
const steps = [
  { type: "thought", iteration: 1, text: "plan" },
  { type: "action", iteration: 1, id: "a1", tool: "get_financials", label: "Get", input: {} },
  { type: "observation", iteration: 1, id: "a1", tool: "get_financials", ok: true, summary: "ok" },
  { type: "bogus", iteration: 1 },
  { type: "action", iteration: 2, id: "a2", tool: "hax", label: "x" },
];

const good = parsePersistedRun({ steps, answer }, "fallback", "success");
check("structured answer used", good.structured && good.answer.answerMarkdown.startsWith("Nike"), good.answer);
check("table kept", good.answer.tables.length === 1 && good.answer.tables[0].rows[0][1] === "44.6%");
check("non-http source dropped", good.answer.sources.length === 1 && good.answer.sources[0].n === 1);
check("non-string follow-up dropped", good.answer.followUps.length === 1);
check("invalid steps dropped", good.steps.length === 3, good.steps);

for (const [name, trace] of [
  ["null trace", null],
  ["array trace", []],
  ["string trace", "oops"],
  ["answer null", { steps: [], answer: null }],
  ["answer wrong kind", { steps: [], answer: { ...answer, kind: "weird" } }],
  ["answer no markdown", { steps: [], answer: { kind: "answer" } }],
  ["steps not array", { steps: 5, answer: null }],
] as const) {
  const r = parsePersistedRun(trace, "Stored text", "success");
  check(`legacy: ${name} falls back to text`, !r.structured && r.answer.answerMarkdown === "Stored text" && r.answer.kind === "answer" && r.answer.notes.length === 1, r);
}
const empty = parsePersistedRun(null, null, "failed");
check("failed + no text -> error panel", empty.answer.kind === "error" && empty.answer.answerMarkdown.length > 0);
const decl = parsePersistedRun({ steps: [], answer: { ...answer, kind: "declined", tables: [], sources: [] } }, "x", "failed");
check("declined kind preserved", decl.answer.kind === "declined");

check("label answer", statusLabel("answer", "success") === "Answer");
check("label declined", statusLabel("declined", "failed") === "Declined");
check("label not_covered", statusLabel("not_covered", "failed") === "Not covered");
check("label insufficient", statusLabel("insufficient_data", "failed") === "Incomplete");
check("label clarification", statusLabel("clarification", "failed") === "Clarification");
check("label legacy success", statusLabel(null, "success") === "Answer");
check("label legacy failed", statusLabel(null, "failed") === "Error");
check("label junk kind", statusLabel("zzz", "failed") === "Error");

const now = new Date(2026, 9, 19, 12, 0, 0);
const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
const g = groupByDay(
  [
    { createdAt: at(19, 11) },
    { createdAt: at(19, 0) },
    { createdAt: at(18, 23) },
    { createdAt: at(18, 0) },
    { createdAt: at(17, 23) },
    { createdAt: "garbage" },
  ],
  now,
);
check("grouping", g.map((x) => `${x.label}:${x.rows.length}`).join() === "Today:2,Yesterday:2,Earlier:2", g.map((x) => `${x.label}:${x.rows.length}`));
const firstOfMonth = groupByDay([{ createdAt: new Date(2026, 8, 30, 10).toISOString() }], new Date(2026, 9, 1, 9));
check("yesterday across month boundary", firstOfMonth[0].label === "Yesterday");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
