// NDJSON stream for /api/agent, with run persistence. Kept free of Next/Supabase imports (they come in
// through `deps`) so scripts can test the failure paths without a browser session.
import type { ResearchAuditSummary } from "../audit/types";
import type { AgentEvent, AgentResult, AnswerExtras, TraceStep } from "./types";

export type RunRecord = {
  question: string;
  answer: string | null;
  trace: unknown;
  status: "success" | "failed";
};

export type StreamDeps = {
  run(
    question: string,
    onStep: (step: TraceStep) => void,
    signal: AbortSignal,
    onAnswerDelta: (text: string) => void,
    onAnswerExtras: (extras: AnswerExtras) => void,
  ): Promise<AgentResult>;
  save(record: RunRecord): Promise<void>; // should throw on failure
  // Optional comparability enrichment (lib/audit/research.ts). Bounded and expected never to throw; a throw is
  // treated as "no audit". It never changes the result, its status or usage.
  audit?(result: AgentResult, signal: AbortSignal): Promise<ResearchAuditSummary | null>;
  saveTimeoutMs?: number;
};

// Persistence is best effort: it never throws and never waits forever, so a DB problem
// can't hide an answer that is already produced (SPEC STREAM-004).
async function saveBestEffort(deps: StreamDeps, record: RunRecord) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deps.save(record),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("save timed out")), deps.saveTimeoutMs ?? 8_000);
      }),
    ]);
  } catch (err) {
    console.error("[api/agent] failed to save run:", err instanceof Error ? err.message : "unknown error");
  } finally {
    clearTimeout(timer);
  }
}

export function createAgentStream(question: string, deps: StreamDeps): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false; // set when the client disconnects or the stream is closed
  const abort = new AbortController(); // aborted on disconnect so the agent stops spending tokens

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Never throws: after a client disconnect, enqueue throws and the agent must not be interrupted by it.
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      try {
        // Previews are display-only: they are never saved, and `final` always follows (or `error`).
        const result = await deps.run(
          question,
          (step) => send({ type: "step", step }),
          abort.signal,
          (text) => send({ type: "answer_delta", text }),
          (extras) => send({ type: "answer_extras", ...extras }),
        );
        let audit: ResearchAuditSummary | null = null;
        if (deps.audit) {
          try {
            audit = await deps.audit(result, abort.signal);
          } catch (err) {
            console.error("[api/agent] audit failed:", err instanceof Error ? err.message : "unknown error");
          }
        }
        // Saved before `final` so the next request already sees this run when usage is counted (Step 3).
        await saveBestEffort(deps, {
          question,
          answer: result.answer.answerMarkdown,
          trace: { steps: result.trace, answer: result.answer, ...(audit ? { audit } : {}) },
          status: result.status,
        });
        send({ type: "final", result });
        if (audit) send({ type: "audit", audit });
      } catch (err) {
        console.error("[api/agent]", err);
        await saveBestEffort(deps, {
          question,
          answer: null,
          trace: { steps: [], answer: null },
          status: "failed",
        });
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
}
