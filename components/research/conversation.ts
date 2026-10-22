import type { AgentEvent, AgentResult, AnswerExtras, TraceStep } from "@/lib/agent/types";
import { toResearchAudit, type ResearchAuditSummary } from "@/lib/audit/types";
import type { UsageDenial } from "@/lib/usage-types";

// The turns asked in this visit to the workspace, oldest first. Each turn owns its own stream state, so a new
// question appends a turn and stream events only ever touch the turn they belong to (looked up by id). Saved turns
// loaded from Supabase are rendered separately and never mixed in here, so a completed turn has one source of truth.
export type LiveTurn = {
  id: string;
  question: string;
  steps: TraceStep[];
  result: AgentResult | null;
  draftAnswer: string; // provisional prose while the answer is written; replaced by `result`
  draftExtras: AnswerExtras | null; // verified preview rows/sources/follow-ups
  draftDone: boolean; // the preview has finished revealing after `final` arrived
  runError: string | null; // the request or the run failed
  limit: UsageDenial | null; // HTTP 402: out of questions (not an error)
  audit: ResearchAuditSummary | null; // comparability review, if the server ran one for this turn
};

export function newTurn(id: string, question: string): LiveTurn {
  return { id, question, steps: [], result: null, draftAnswer: "", draftExtras: null, draftDone: false, runError: null, limit: null, audit: null };
}

// Applies `change` to the turn with this id and leaves every other turn untouched (same objects).
export function updateTurn(turns: LiveTurn[], id: string, change: (turn: LiveTurn) => LiveTurn): LiveTurn[] {
  return turns.map((t) => (t.id === id ? change(t) : t));
}

// One NDJSON event folded into its own turn.
export function applyEvent(turn: LiveTurn, event: AgentEvent): LiveTurn {
  switch (event.type) {
    case "step":
      return { ...turn, steps: [...turn.steps, event.step] };
    case "answer_delta":
      return { ...turn, draftAnswer: event.text };
    case "answer_extras":
      return { ...turn, draftExtras: { tables: event.tables, sources: event.sources, followUps: event.followUps } };
    case "final":
      return { ...turn, result: event.result }; // the preview (if any) finishes revealing, then this takes over
    case "audit":
      return { ...turn, audit: toResearchAudit(event.audit) };
    case "error":
      return { ...turn, draftAnswer: "", draftExtras: null, runError: event.message };
    default:
      return turn;
  }
}

// The validated answer is shown once any preview has finished revealing (or immediately if there was none).
export function turnView(turn: LiveTurn) {
  return {
    resultVisible: turn.result !== null && (!turn.draftAnswer || turn.draftDone),
    previewVisible: !!turn.draftAnswer && !turn.runError && !(turn.result !== null && turn.draftDone),
  };
}
