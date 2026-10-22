// Pure helpers for Research History (docs/RESEARCH_HISTORY_PLAN.md). No server imports: used by server pages,
// client components and offline tests. Everything here tolerates old or malformed `runs.trace` rows.
import type { AnswerKind, AnswerTable, FinalAnswer, Source, ToolName, TraceStep } from "./agent/types";
import { toResearchAudit, type ResearchAuditSummary } from "./audit/types";

export type PersistedRun = {
  steps: TraceStep[];
  answer: FinalAnswer;
  structured: boolean; // false when the answer was rebuilt from the stored text (legacy/malformed trace)
  audit: ResearchAuditSummary | null; // only when one was actually saved with the run; never reconstructed
};

const KINDS: readonly AnswerKind[] = [
  "answer",
  "clarification",
  "not_covered",
  "declined",
  "off_topic",
  "insufficient_data",
  "error",
];
const TOOLS: readonly string[] = ["lookup_ticker", "get_financials", "calculate", "search_news", "final_answer"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

function toSource(v: unknown): Source | null {
  if (!isObj(v) || typeof v.n !== "number" || !isHttp(v.url)) return null;
  if (v.type === "filing") {
    if (typeof v.company !== "string" || typeof v.form !== "string") return null;
    return {
      n: v.n,
      type: "filing",
      company: v.company,
      ticker: typeof v.ticker === "string" ? v.ticker : "",
      form: v.form,
      fiscalYear: typeof v.fiscalYear === "number" ? v.fiscalYear : 0,
      periodEnd: typeof v.periodEnd === "string" ? v.periodEnd : "",
      filed: typeof v.filed === "string" ? v.filed : "",
      accession: typeof v.accession === "string" ? v.accession : "",
      url: v.url,
    };
  }
  if (v.type === "news" && typeof v.title === "string") {
    return {
      n: v.n,
      type: "news",
      title: v.title,
      url: v.url,
      publishedDate: typeof v.publishedDate === "string" ? v.publishedDate : null,
      domain: typeof v.domain === "string" ? v.domain : "",
    };
  }
  return null;
}

function toTable(v: unknown): AnswerTable | null {
  if (!isObj(v) || !Array.isArray(v.rows)) return null;
  const rows = v.rows.filter(Array.isArray).map((r: unknown[]) => r.map((c) => (typeof c === "string" ? c : String(c ?? ""))));
  return { title: typeof v.title === "string" ? v.title : "", columns: strings(v.columns), rows };
}

function toStep(v: unknown): TraceStep | null {
  if (!isObj(v) || typeof v.iteration !== "number") return null;
  if ((v.type === "thought" || v.type === "info") && typeof v.text === "string") {
    return { type: v.type, iteration: v.iteration, text: v.text };
  }
  if (v.type === "action" && typeof v.id === "string" && typeof v.label === "string" && TOOLS.includes(v.tool as string)) {
    return { type: "action", iteration: v.iteration, id: v.id, tool: v.tool as ToolName, label: v.label, input: v.input };
  }
  if (v.type === "observation" && typeof v.id === "string" && TOOLS.includes(v.tool as string)) {
    return {
      type: "observation",
      iteration: v.iteration,
      id: v.id,
      tool: v.tool as ToolName,
      ok: v.ok === true,
      summary: typeof v.summary === "string" ? v.summary : "",
    };
  }
  return null;
}

// Validates a stored FinalAnswer. Returns null (never throws) if it cannot be rendered safely.
function toAnswer(v: unknown): FinalAnswer | null {
  if (!isObj(v) || typeof v.answerMarkdown !== "string" || !KINDS.includes(v.kind as AnswerKind)) return null;
  const clarification = v.clarification;
  const validClarification =
    isObj(clarification) &&
    typeof clarification.query === "string" &&
    typeof clarification.question === "string" &&
    Array.isArray(clarification.options);
  return {
    kind: v.kind as AnswerKind,
    answerMarkdown: v.answerMarkdown,
    tables: (Array.isArray(v.tables) ? v.tables : []).map(toTable).filter((t): t is AnswerTable => t !== null),
    sources: (Array.isArray(v.sources) ? v.sources : []).map(toSource).filter((s): s is Source => s !== null),
    followUps: strings(v.followUps),
    notes: strings(v.notes),
    ...(validClarification ? { clarification: clarification as FinalAnswer["clarification"] } : {}),
  };
}

// Reads `trace` and the stored answer text. Prefers the structured trace.answer (HIST-004); otherwise rebuilds a
// plain FinalAnswer from the text so the page still renders. Never parses prose back into tables.
export function parsePersistedRun(trace: unknown, answerText: string | null, status: string): PersistedRun {
  const t = isObj(trace) ? trace : null;
  const steps = t && Array.isArray(t.steps) ? t.steps.map(toStep).filter((s): s is TraceStep => s !== null) : [];
  const structured = t ? toAnswer(t.answer) : null;
  if (structured) return { steps, answer: structured, structured: true, audit: toResearchAudit(t?.audit) };

  const text = answerText?.trim();
  const ok = status === "success" && !!text;
  return {
    steps,
    structured: false,
    audit: null,
    answer: {
      kind: ok ? "answer" : "error",
      answerMarkdown: text || "This run didn't save a result.",
      tables: [],
      sources: [],
      followUps: [],
      notes: ok ? ["Saved in an older format, so only the text is shown. Tables and sources aren't available."] : [],
    },
  };
}

const LABELS: Record<AnswerKind, string> = {
  answer: "Answer",
  clarification: "Clarification",
  not_covered: "Not covered",
  declined: "Declined",
  off_topic: "Off topic",
  insufficient_data: "Incomplete",
  error: "Error",
};

// Status chip text from the saved kind (plan section 21). Without a kind: success is an Answer, failed is an Error.
export function statusLabel(kind: string | null | undefined, status: string): string {
  if (kind && KINDS.includes(kind as AnswerKind)) return LABELS[kind as AnswerKind];
  return status === "success" ? "Answer" : "Error";
}

// One research thread in the History list. Grouped and ordered by last activity (updatedAt).
export type ThreadRow = { id: string; title: string; createdAt: string; updatedAt: string; runCount: number };

export type HistoryGroup<T> = { label: "Today" | "Yesterday" | "Earlier"; rows: T[] };

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Groups already-sorted rows by the viewer's local calendar day, preserving order.
export function groupByDay<T extends { createdAt: string }>(
  rows: T[],
  now: Date,
  timeOf: (row: T) => string = (row) => row.createdAt, // History lists pass updatedAt: threads sort by last activity
): HistoryGroup<T>[] {
  const today = dayStart(now);
  const yesterday = dayStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: HistoryGroup<T>[] = [];
  for (const row of rows) {
    const t = new Date(timeOf(row)).getTime();
    const label = Number.isNaN(t) ? "Earlier" : t >= today ? "Today" : t >= yesterday ? "Yesterday" : "Earlier";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}
