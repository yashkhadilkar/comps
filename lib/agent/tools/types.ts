import type Anthropic from "@anthropic-ai/sdk";
import type { ToolName } from "../types";

export type FilingMeta = {
  type: "filing";
  key: string; // accession number
  company: string;
  ticker: string;
  cik: number;
  form: string;
  fiscalYear: number;
  periodEnd: string;
  filed: string;
  accession: string;
  url: string;
};

export type NewsMeta = {
  type: "news";
  key: string; // news-N
  title: string;
  url: string;
  publishedDate: string | null;
  domain: string;
};

export type ToolContext = {
  registerFiling(meta: Omit<FilingMeta, "type">): void;
  registerNews(meta: Omit<NewsMeta, "type" | "key">): string; // returns "news-N"
  citations: Map<string, FilingMeta | NewsMeta>;
  // Every figure string a tool handed to the model, so the final answer can be checked against them.
  // Maps a normalized figure to the citation keys that report it ("" = computed by calculate).
  figures: Map<string, Set<string>>;
  registerFigure(display: string, key?: string): void;
  // The first ambiguous lookup_ticker result of this run, if any. While set, the answer may not guess
  // between its candidates (SPEC AGENT-009). Per-run state, nothing persists between requests.
  ambiguous: { query: string; candidates: { name: string; ticker: string; weak: boolean }[] } | null;
  registerAmbiguous(query: string, candidates: { name: string; ticker: string; weak: boolean }[]): void;
  // Latest annual period end per ticker, to check that differing fiscal year-ends are shown.
  periodEnds: Map<string, string>;
};

export type ToolResult =
  | { ok: true; summary: string; data: unknown; forModel?: string }
  | { ok: false; error: string };

// Default is `any` so a heterogeneous TOOLS array can hold tools with different input types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef<I = any> = {
  name: Exclude<ToolName, "final_answer">;
  definition: Anthropic.Beta.BetaTool;
  label(input: I): string;
  // `signal` fires when the attempt times out or the user disconnects; tools with their own fetch should honor it.
  run(input: I, ctx: ToolContext, signal?: AbortSignal): Promise<ToolResult>;
  timeoutMs: number;
};
