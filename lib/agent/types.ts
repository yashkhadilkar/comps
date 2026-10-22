// Shared agent types. No server-only imports: the browser uses these too.
import type { ResearchAuditSummary } from "../audit/types";

export type ToolName =
  | "lookup_ticker"
  | "get_financials"
  | "calculate"
  | "search_news"
  | "final_answer";

export type TraceStep =
  | { type: "thought"; iteration: number; text: string }
  | { type: "action"; iteration: number; id: string; tool: ToolName; label: string; input: unknown }
  | {
      type: "observation";
      iteration: number;
      id: string;
      tool: ToolName;
      ok: boolean;
      summary: string;
      data?: unknown;
    }
  | { type: "info"; iteration: number; text: string };

export type AnswerKind =
  | "answer" // a real, cited answer
  | "clarification" // ambiguous company, asking the user to pick
  | "not_covered" // company not an SEC filer (e.g. Adidas) or not found
  | "declined" // buy/sell or price prediction request
  | "off_topic"
  | "insufficient_data"
  | "error"; // system-generated only: the AI service or server failed. Never offered to the model

export type Source =
  | {
      n: number;
      type: "filing";
      company: string;
      ticker: string;
      form: string;
      fiscalYear: number;
      periodEnd: string;
      filed: string;
      accession: string;
      url: string;
    }
  | {
      n: number;
      type: "news";
      title: string;
      url: string;
      publishedDate: string | null;
      domain: string;
    };

export type AnswerTable = { title: string; columns: string[]; rows: string[][] };

// What the stream previews before `final`: only rows, sources and follow-ups the server already verified.
export type AnswerExtras = { tables: AnswerTable[]; sources: Source[]; followUps: string[] };

// Set when a company name matched several SEC filers and the user must choose (SPEC AGENT-009).
export type Clarification = {
  query: string; // the name that was ambiguous, e.g. "Delta"
  question: string; // the user's original question
  options: { name: string; ticker: string; question: string }[]; // max 3; `question` is the ask with the ticker swapped in
};

export type FinalAnswer = {
  kind: AnswerKind;
  answerMarkdown: string; // contains [1], [2] markers matching sources[].n
  tables: AnswerTable[];
  sources: Source[];
  followUps: string[]; // 3 clickable follow-up questions
  notes: string[]; // e.g. "Assuming you meant Nike, Inc. (NKE)", "FY2020 missing for UAA"
  clarification?: Clarification; // only on kind "clarification" when lookup_ticker found an ambiguous name
};

export type AgentResult = {
  status: "success" | "failed";
  answer: FinalAnswer;
  trace: TraceStep[];
};

// NDJSON events streamed from /api/agent (one JSON object per line)
export type AgentEvent =
  | { type: "step"; step: TraceStep }
  | ({ type: "answer_extras" } & AnswerExtras) // verified rows/sources/follow-ups written so far (cumulative); preview only
  | { type: "answer_delta"; text: string } // provisional final-answer prose so far (cumulative, unverified); only `final` is authoritative
  | { type: "final"; result: AgentResult }
  | { type: "audit"; audit: ResearchAuditSummary } // optional, after `final`: deterministic comparability check; never changes the answer
  | { type: "error"; message: string };
