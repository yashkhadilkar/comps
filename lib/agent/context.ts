// Conversation context for thread follow-ups (docs/THREADS_CONTINUATION_PLAN.md sections 12-17).
// Pure and deterministic: no model call, no server imports. Prior answers are context for resolving references
// ("these companies", "that margin"), never evidence: citation markers are stripped, and sources, tables and
// traces are not included at all.
import { parsePersistedRun } from "../history-parse";

export const MAX_PRIOR_RUNS = 3; // deliberate capstone bound: latency and prompt cost stay predictable
export const MAX_PRIOR_QUESTION_CHARS = 1000;
export const MAX_PRIOR_ANSWER_CHARS = 2500;

export type PriorRunRecord = { question: string; answer: string | null; trace: unknown; status: string };
export type PriorTurn = { question: string; answer: string };

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

// Citation keys like [1] or [news-2] must not survive into the prompt, and the wrapper tag must not be forgeable.
function clean(text: string): string {
  return text
    .replace(/\[(?:news-)?\d+\]/gi, "")
    .replace(/<\/?\s*prior_turns?\s*>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// `runs` are the thread's most recent completed runs in any order; the newest MAX_PRIOR_RUNS are kept, oldest first.
// Runs without a saved answer, or that were not real answers, are skipped.
export function toPriorTurns(runs: (PriorRunRecord & { created_at: string })[]): PriorTurn[] {
  return runs
    .filter((r) => r.status === "success")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-MAX_PRIOR_RUNS)
    .flatMap((r) => {
      const parsed = parsePersistedRun(r.trace, r.answer, r.status).answer;
      if (parsed.kind !== "answer") return [];
      let answer = clean(parsed.answerMarkdown);
      const notes = parsed.notes.map(clean).filter(Boolean);
      if (notes.length) answer += `\n\nImportant notes: ${notes.join("; ")}`;
      return [{ question: clip(clean(r.question), MAX_PRIOR_QUESTION_CHARS), answer: clip(answer, MAX_PRIOR_ANSWER_CHARS) }];
    });
}

// The block placed in the first user message. Empty string when there is nothing to carry over.
export function formatPriorContext(turns: PriorTurn[]): string {
  if (!turns.length) return "";
  const body = turns.map((t, i) => `Turn ${i + 1}\nUser asked: ${t.question}\nComps answered: ${t.answer}`).join("\n\n");
  return (
    "Earlier questions in this research thread (oldest first). This is conversational context only, to resolve references such as " +
    '"these companies" or "that margin". It is NOT evidence: do not treat figures, citations or claims from earlier answers as ' +
    "current evidence. Re-fetch any financial or news data needed for the new answer using the tools, and if an earlier figure " +
    "differs from newly fetched tool output, the tool output wins. If a reference is still genuinely ambiguous, ask for clarification.\n" +
    `<prior_turns>\n${body}\n</prior_turns>`
  );
}
