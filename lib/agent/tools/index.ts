// Tool registry, executor (timeout + one retry), citation registry, and final_answer handling.
import type Anthropic from "@anthropic-ai/sdk";
import { rewriteQuestion } from "../clarify";
import { NonRetryableError } from "../errors";
import type { PreviewParts } from "../partialJson";
import type { AnswerExtras, AnswerKind, AnswerTable, Clarification, FinalAnswer, Source, ToolName } from "../types";
import { calculate } from "./calculate";
import { getFinancials } from "./getFinancials";
import { lookupTicker } from "./lookupTicker";
import { searchNews } from "./searchNews";
import type { FilingMeta, NewsMeta, ToolContext, ToolDef, ToolResult } from "./types";

export type { ToolContext, ToolDef, ToolResult } from "./types";

// Fixed order: tool definitions sit at the front of the cached prompt prefix.
export const TOOLS: ToolDef[] = [lookupTicker, getFinancials, calculate, searchNews];

const BY_NAME = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export const FINAL_ANSWER_TOOL: Anthropic.Beta.BetaTool = {
  name: "final_answer",
  description:
    "Submit the final response. Always end by calling this tool exactly once. Every figure in " +
    "answer_markdown and tables must come from a tool result and carry an [n] marker whose citation key " +
    "you received from a tool.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      thought: { type: "string", description: "One short sentence on how you arrived at this answer." },
      kind: {
        type: "string",
        enum: ["answer", "clarification", "not_covered", "declined", "off_topic", "insufficient_data"],
        description: "The type of response.",
      },
      answer_markdown: {
        type: "string",
        description: "The response in short markdown. Put [n] markers after cited figures.",
      },
      tables: {
        type: "array",
        description: "Comparison tables. May be empty.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          },
          required: ["title", "columns", "rows"],
          additionalProperties: false,
        },
      },
      citations: {
        type: "array",
        description: "Sources behind the [n] markers. key is a citationKey from a tool result.",
        items: {
          type: "object",
          properties: { n: { type: "integer" }, key: { type: "string" } },
          required: ["n", "key"],
          additionalProperties: false,
        },
      },
      follow_ups: {
        type: "array",
        items: { type: "string" },
        description: "Exactly 3 short follow-up questions the user could ask next. Empty for a clarification.",
      },
      clarification_options: {
        type: "array",
        description:
          "Only for kind clarification after an ambiguous lookup_ticker: up to 3 of its candidates the user most " +
          "plausibly meant, best first, skipping obviously unrelated ones. ticker must be one lookup_ticker returned. Otherwise empty.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, ticker: { type: "string" } },
          required: ["name", "ticker"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "array",
        items: { type: "string" },
        description: "Assumptions, missing years, fiscal-year caveats. May be empty.",
      },
    },
    required: ["thought", "kind", "answer_markdown", "tables", "citations", "follow_ups", "clarification_options", "notes"],
    additionalProperties: false,
  },
};

export const ALL_TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  ...TOOLS.map((t) => t.definition),
  FINAL_ANSWER_TOOL,
];

// "$46.71B" / "46.71B" / "-9.8%" / "+9.8" all normalize to the same comparable text.
export function normalizeFigure(text: string): string {
  return text.replace(/[\s$,%+\-−]/g, "").toLowerCase();
}

export function createToolContext(): ToolContext {
  const citations = new Map<string, FilingMeta | NewsMeta>();
  const figures = new Map<string, Set<string>>();
  const periodEnds = new Map<string, string>();
  let newsCounter = 0;
  const ctx: ToolContext = {
    citations,
    figures,
    periodEnds,
    ambiguous: null,
    registerAmbiguous(query, candidates) {
      ctx.ambiguous ??= { query, candidates: candidates.slice(0, 3) };
    },
    registerFiling(meta) {
      citations.set(meta.key, { type: "filing", ...meta });
      const prev = periodEnds.get(meta.ticker);
      if (!prev || meta.periodEnd > prev) periodEnds.set(meta.ticker, meta.periodEnd);
    },
    registerNews(meta) {
      const key = `news-${++newsCounter}`;
      citations.set(key, { type: "news", key, ...meta });
      return key;
    },
    registerFigure(display, key = "") {
      const norm = normalizeFigure(display);
      if (!norm) return;
      const keys = figures.get(norm) ?? new Set<string>();
      keys.add(key);
      figures.set(norm, keys);
    },
  };
  return ctx;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const attempt = new AbortController();
  const signal = outer ? AbortSignal.any([attempt.signal, outer]) : attempt.signal;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      attempt.abort(); // stop the timed-out work so a retry does not run alongside it
      reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  return Promise.race([run(signal), timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const def = BY_NAME.get(name);
  if (!def) return { ok: false, error: `Unknown tool: ${name}` };
  if (!input || typeof input !== "object") return { ok: false, error: "Tool input must be an object." };

  // Required string fields must be non-empty.
  const required = (def.definition.input_schema.required ?? []) as string[];
  const props = def.definition.input_schema.properties as Record<string, { type?: string }>;
  for (const field of required) {
    if (props[field]?.type === "string") {
      const value = (input as Record<string, unknown>)[field];
      if (typeof value !== "string" || !value.trim()) {
        return { ok: false, error: `Missing required field: ${field}` };
      }
    }
  }

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal?.aborted) return { ok: false, error: `${name} was cancelled.` };
    try {
      // A tool returning { ok: false } is a real answer ("not found"), so it is not retried.
      return await withTimeout((s) => def.run(input, ctx, s), def.timeoutMs, signal);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Bad credentials, missing config and "not found" will fail the same way again: report them now.
      if (err instanceof NonRetryableError) return { ok: false, error: `${name} failed: ${lastError}` };
      if (attempt === 1) await sleep(500);
    }
  }
  return { ok: false, error: `${name} failed after a retry: ${lastError}` };
}

type FinalAnswerInput = {
  kind?: AnswerKind;
  answer_markdown?: string;
  tables?: { title: string; columns: string[]; rows: string[][] }[];
  citations?: { n: number; key: string }[];
  follow_ups?: string[];
  clarification_options?: { name: string; ticker: string }[];
  notes?: string[];
};

function toSource(n: number, meta: FilingMeta | NewsMeta): Source {
  if (meta.type === "filing") {
    return {
      n,
      type: "filing",
      company: meta.company,
      ticker: meta.ticker,
      form: meta.form,
      fiscalYear: meta.fiscalYear,
      periodEnd: meta.periodEnd,
      filed: meta.filed,
      accession: meta.accession,
      url: meta.url,
    };
  }
  return {
    n,
    type: "news",
    title: meta.title,
    url: meta.url,
    publishedDate: meta.publishedDate,
    domain: meta.domain,
  };
}

const ACCESSION_MARKER = /(\s?)\[(\d{10}-\d{2}-\d{6}|news-\d{1,3})\]/g; // models sometimes cite the raw key (filing accession or news-N) instead of [n]
const NUMBER_MARKER = /\s?\[(\d{1,2})\]/g;
const ANY_MARKER = /\[(\d{1,2})\]/g;
// A figure worth checking: has $, %, a decimal point, or a B/M suffix (plain integers like "3 companies" are skipped).
const FIGURE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|[BM]\b)?/g;
const MONEY_FIGURE = /\$\d[\d,]*(?:\.\d+)?[BM]?\b|\b\d[\d,]*\.\d+[BM]\b/g;

const NO_SOURCES_MESSAGE =
  "I couldn't attach verifiable sources to this answer, so I'm not showing its figures. Please try asking again.";

function figuresIn(text: string): string[] {
  const cleaned = text
    .replace(ANY_MARKER, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/FY\s?\d{4}/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
  return (cleaned.match(FIGURE) ?? []).map((t) => t.trim()).filter((t) => /[$%.BM]/.test(t));
}

function daysApart(a: string, b: string): number {
  const doy = (d: string) => (Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000;
  const diff = Math.abs(doy(a) - doy(b));
  return Math.min(diff, 365 - diff);
}

// Turns the model's final_answer arguments into a FinalAnswer (SPEC CITE-002/003/005). The server:
// - drops citation keys the tools never returned, so a made-up citation can't reach the user
// - rewrites a raw accession key used as a marker to its [n] (or drops it if the key is unknown)
// - removes [n] markers with no matching source, so the UI never shows a dead reference
// - repoints a table figure's marker to the filing that actually reports it, and adds a missing one
// - warns when a figure matches nothing a tool returned, and when fiscal year-ends differ without dates shown
// - downgrades an "answer" left with zero sources to insufficient_data, so it is not a success
export function resolveFinalAnswer(input: FinalAnswerInput, ctx: ToolContext, question = ""): FinalAnswer {
  const notes = [...(input.notes ?? [])];

  // SPEC AGENT-009: if lookup_ticker found an ambiguous name, the model may not pick one for the user.
  // Whether it submitted an "answer" or its own "clarification", the user gets options to choose from.
  // The model chooses which candidates to offer; the server only accepts tickers the tool returned and
  // shows the tool's own names. With no valid choice from the model, the tool's strongest candidates are used.
  const ambiguity = ctx.ambiguous;
  if (ambiguity && (input.kind === "answer" || input.kind === "clarification" || input.kind === undefined)) {
    const byTicker = new Map(ambiguity.candidates.map((c) => [c.ticker.toUpperCase(), c]));
    const chosen = new Map<string, { name: string; ticker: string }>();
    const anyStrong = ambiguity.candidates.some((c) => !c.weak);
    for (const o of input.clarification_options ?? []) {
      const c = byTicker.get(String(o.ticker).trim().toUpperCase());
      // Weak fuzzy hits (low-confidence name look-alikes) are never offered while a stronger candidate exists.
      if (c && !(c.weak && anyStrong)) chosen.set(c.ticker, { name: c.name, ticker: c.ticker });
    }
    if (!chosen.size) {
      for (const c of ambiguity.candidates) if (!c.weak || !anyStrong) chosen.set(c.ticker, c);
    }
    const clarification: Clarification = {
      query: ambiguity.query,
      question: question || ambiguity.query,
      options: [...chosen.values()].slice(0, 3).map((c) => ({
        name: c.name,
        ticker: c.ticker,
        question: rewriteQuestion(question, ambiguity.query, c.ticker),
      })),
    };
    return {
      kind: "clarification",
      answerMarkdown: `"${ambiguity.query}" could be more than one company that files with the SEC. Which one do you mean?`,
      tables: [],
      sources: [],
      followUps: [],
      notes: [],
      clarification,
    };
  }

  const sources: Source[] = [];
  const nByKey = new Map<string, number>();
  const keyByN = new Map<number, string>();
  let unknownKeys = 0;
  let duplicateN = 0;

  for (const c of input.citations ?? []) {
    const meta = ctx.citations.get(c.key);
    if (!meta) {
      unknownKeys++;
    } else if (keyByN.has(c.n)) {
      duplicateN++;
    } else {
      keyByN.set(c.n, c.key);
      sources.push(toSource(c.n, meta));
      if (!nByKey.has(c.key)) nByKey.set(c.key, c.n);
    }
  }

  // The [n] for a retrieved key, adding it to the sources under a fresh number if the model left it out.
  const ensureSource = (key: string): number | undefined => {
    const known = nByKey.get(key);
    if (known !== undefined) return known;
    const meta = ctx.citations.get(key);
    if (!meta) return undefined;
    const n = Math.max(0, ...keyByN.keys()) + 1;
    keyByN.set(n, key);
    nByKey.set(key, n);
    sources.push(toSource(n, meta));
    return n;
  };

  let removedMarkers = 0;
  const fixMarkers = (text: string): string =>
    text
      .replace(ACCESSION_MARKER, (_m, space: string, key: string) => {
        const n = ensureSource(key);
        if (n === undefined) {
          removedMarkers++;
          return "";
        }
        return `${space}[${n}]`;
      })
      .replace(NUMBER_MARKER, (m, n: string) => {
        if (keyByN.has(Number(n))) return m;
        removedMarkers++;
        return "";
      });

  // Table cells holding a $ figure from get_financials must cite a filing that reports that figure.
  let correctedCitations = 0;
  const fixCell = (cell: string): string => {
    const money = (cell.match(MONEY_FIGURE) ?? []).map(normalizeFigure);
    const reporters = money.length === 1 ? ctx.figures.get(money[0]) : undefined;
    if (!reporters || reporters.has("") || reporters.size === 0) return cell;
    const markers = [...cell.matchAll(ANY_MARKER)];
    if (markers.length > 1) return cell;
    const keys = [...reporters];
    if (markers.length === 1) {
      const cited = keyByN.get(Number(markers[0][1]));
      if (cited && reporters.has(cited)) return cell;
    }
    const n = ensureSource(keys[0]);
    if (n === undefined) return cell;
    correctedCitations++;
    return markers.length === 1 ? cell.replace(ANY_MARKER, `[${n}]`) : `${cell.trim()} [${n}]`;
  };

  const answerMarkdown = fixMarkers(input.answer_markdown ?? "");
  const tables = (input.tables ?? []).map((t) => ({
    ...t,
    rows: t.rows.map((r) => r.map((cell) => fixCell(fixMarkers(cell)))),
  }));

  if (unknownKeys) {
    notes.push(`Removed ${unknownKeys} citation${unknownKeys === 1 ? "" : "s"} that did not match any retrieved source.`);
  }
  if (duplicateN) notes.push(`Removed ${duplicateN} duplicate source number${duplicateN === 1 ? "" : "s"}.`);
  if (removedMarkers) {
    notes.push(`Removed ${removedMarkers} reference marker${removedMarkers === 1 ? "" : "s"} with no matching source.`);
  }
  if (correctedCitations) {
    notes.push(
      `Corrected ${correctedCitations} citation${correctedCitations === 1 ? "" : "s"} to the filing that reports the figure.`,
    );
  }

  const followUps = (input.follow_ups ?? []).slice(0, 3);
  sources.sort((a, b) => a.n - b.n);
  const kind = input.kind ?? "answer";

  if (kind === "answer" && sources.length === 0) {
    return { kind: "insufficient_data", answerMarkdown: NO_SOURCES_MESSAGE, tables: [], sources: [], followUps, notes };
  }

  if (kind === "answer") {
    const shown = [answerMarkdown, ...tables.flatMap((t) => t.rows.flat())].join("\n");
    const unmatched = figuresIn(shown).filter((f) => !ctx.figures.has(normalizeFigure(f)));
    if (unmatched.length) {
      const sample = [...new Set(unmatched)].slice(0, 3).join(", ");
      notes.push(
        `${unmatched.length} figure${unmatched.length === 1 ? "" : "s"} (${sample}) could not be matched to retrieved data. Check it against the cited filing.`,
      );
    }

    // CITE-005: when year-ends differ, period-end dates must be visible.
    const ends = [...ctx.periodEnds.values()];
    const differ = ends.some((a) => ends.some((b) => daysApart(a, b) > 45));
    if (differ && !/\d{4}-\d{2}-\d{2}/.test([shown, ...notes].join("\n"))) {
      const list = [...ctx.periodEnds].map(([t, e]) => `${t} ${e}`).join(", ");
      notes.push(`Fiscal year-ends differ across these companies, so rows are not the same calendar period. Latest period ends: ${list}.`);
    }
  }

  return { kind, answerMarkdown, tables, sources, followUps, notes };
}

// Preview of the tables, sources and follow-ups the model has finished writing, for the progressive stream. It only
// passes what the final check would also accept: a source whose key a tool returned, and table rows whose figures all
// match data the tools retrieved (the same figuresIn/ctx.figures test resolveFinalAnswer applies). Rows with an
// unmatched figure are withheld here (the final answer still shows them, with its note). Citation markers are left
// as written; the client hides them in previews. The `final` event remains the only authoritative result.
export function previewExtras(parts: PreviewParts, ctx: ToolContext): AnswerExtras {
  const seen = new Set<number>();
  const sources: Source[] = [];
  for (const c of parts.citations) {
    const meta = ctx.citations.get(c.key);
    if (!meta || seen.has(c.n)) continue;
    seen.add(c.n);
    sources.push(toSource(c.n, meta));
  }
  sources.sort((a, b) => a.n - b.n);

  const tables: AnswerTable[] = [];
  for (const t of parts.tables) {
    if (t.title === null || t.columns === null) continue; // wait for the header
    const rows = t.rows.filter((row) => figuresIn(row.join("\n")).every((f) => ctx.figures.has(normalizeFigure(f))));
    tables.push({ title: t.title, columns: t.columns, rows });
  }
  return { tables, sources, followUps: parts.followUps.slice(0, 3) };
}

export type { ToolName };
