// The ReAct loop (see docs/ARCHITECTURE.md, "How the agent works").
// Each iteration the model either calls tools (Thought -> Action -> Observation) or calls
// final_answer. Capped at 6 iterations (8 for why/driver questions, see intent.ts); the last one only offers final_answer so the user always
// gets what was found plus what is missing. runAgent never throws.
import Anthropic from "@anthropic-ai/sdk";
import { maxIterationsFor } from "./intent";
import { extractAnswerMarkdown, extractPreviewParts, type PreviewParts } from "./partialJson";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import {
  ALL_TOOL_DEFINITIONS,
  createToolContext,
  executeTool,
  FINAL_ANSWER_TOOL,
  previewExtras,
  resolveFinalAnswer,
  TOOLS,
  type ToolResult,
} from "./tools";
import type { AgentResult, AnswerExtras, AnswerKind, FinalAnswer, ToolName, TraceStep } from "./types";

const DEADLINE_MS = 90_000; // after this, the next model call may only submit final_answer
const HARD_LIMIT_MS = 115_000; // nothing may run past this (route maxDuration is 120s)
const MODEL_CALL_TIMEOUT_MS = 60_000;
const MIN_CALL_MS = 5_000;
const DEFAULT_MODEL = "claude-haiku-5-5";

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name as string, t]));
const SMALL_DATA_TOOLS = new Set<ToolName>(["lookup_ticker", "calculate"]); // others are large: summary only

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 });
  return client;
}

// Time budgets: a model call never outlives the hard limit, and tools never push a run past the
// deadline by more than a few seconds, so the final answer call always has time left.
export function modelCallTimeoutMs(elapsedMs: number): number {
  return Math.min(MODEL_CALL_TIMEOUT_MS, HARD_LIMIT_MS - elapsedMs);
}
export function toolPhaseBudgetMs(elapsedMs: number): number {
  return Math.max(3_000, DEADLINE_MS + 10_000 - elapsedMs);
}

async function withBudget(result: Promise<ToolResult>, ms: number): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const skipped = new Promise<ToolResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: "Skipped: the time limit for this question was reached." }),
      ms,
    );
  });
  try {
    return await Promise.race([result, skipped]);
  } finally {
    clearTimeout(timer);
  }
}

function failedResult(kind: AnswerKind, message: string, trace: TraceStep[]): AgentResult {
  const answer: FinalAnswer = {
    kind,
    answerMarkdown: message,
    tables: [],
    sources: [],
    followUps: [],
    notes: [],
  };
  return { status: "failed", answer, trace };
}

function userFacingApiError(err: unknown, cancelled: boolean): string {
  if (cancelled) return "Cancelled.";
  if (err instanceof Anthropic.RateLimitError) return "Comps is busy right now. Please try again in a minute.";
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("[agent] Anthropic authentication failed. Check ANTHROPIC_API_KEY.");
    return "The agent isn't configured correctly.";
  }
  if (err instanceof Anthropic.APIError) {
    console.error("[agent] Anthropic API error:", err.status, err.message);
    return "The AI service had an error. Please try again.";
  }
  console.error("[agent] unexpected error:", err);
  return "Something went wrong. Please try again.";
}

const DELTA_INTERVAL_MS = 100; // at most ~10 provisional-answer updates per second

// Streaming is on unless AGENT_STREAMING=off (a kill switch, and what the offline tests with a non-SSE mock use).
const streamingEnabled = () => process.env.AGENT_STREAMING !== "off";

// Same request as the non-streaming call, but consumed as a stream so the in-progress `answer_markdown` of a
// final_answer tool call can be shown while it is generated. The returned message is the complete one, so everything
// after this (validation, citation resolution, persistence) is unchanged. Delta problems never throw: a listener
// error only stops further previews.
async function streamModel(
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
  options: { timeout: number; maxRetries: number; signal?: AbortSignal },
  onAnswerDelta: (text: string) => void,
  onParts?: (parts: PreviewParts) => void,
) {
  const stream = getClient().beta.messages.stream(params, options);
  const blocks = new Map<number, { isFinal: boolean; json: string }>();
  let lastText = "";
  let lastParts = "";
  let lastEmit = 0;
  let broken = false;

  const flush = (json: string, force: boolean) => {
    if (broken) return;
    try {
      if (!force && Date.now() - lastEmit < DELTA_INTERVAL_MS) return;
      const text = extractAnswerMarkdown(json);
      const parts = onParts ? extractPreviewParts(json) : null;
      const partsKey = parts ? JSON.stringify(parts) : "";
      const textChanged = text !== null && text !== lastText;
      const partsChanged = parts !== null && partsKey !== lastParts;
      if (!textChanged && !partsChanged) return;
      lastEmit = Date.now();
      if (textChanged) {
        lastText = text;
        if (text) onAnswerDelta(text);
      }
      if (partsChanged && parts) {
        lastParts = partsKey;
        onParts?.(parts);
      }
    } catch (err) {
      broken = true;
      console.error("[agent] answer preview stopped:", err instanceof Error ? err.message : err);
    }
  };

  stream.on("streamEvent", (ev) => {
    if (ev.type === "content_block_start") {
      blocks.set(ev.index, { isFinal: ev.content_block.type === "tool_use" && ev.content_block.name === "final_answer", json: "" });
    } else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta") {
      const b = blocks.get(ev.index);
      if (!b?.isFinal) return;
      b.json += ev.delta.partial_json;
      flush(b.json, false);
    } else if (ev.type === "content_block_stop") {
      const b = blocks.get(ev.index);
      if (b?.isFinal) flush(b.json, true);
    }
  });
  return stream.finalMessage();
}

async function callModel(
  model: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  tools: Anthropic.Beta.BetaTool[],
  timeoutMs: number,
  signal?: AbortSignal,
  onAnswerDelta?: (text: string) => void,
  onParts?: (parts: PreviewParts) => void,
) {
  const isSonnet = model.startsWith("claude-sonnet-5-5");
  const params = {
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    cache_control: { type: "ephemeral" }, // auto-caches the growing message history
    tools,
    messages,
    output_config: { effort: "medium" },
    // Refusal fallback is Sonnet-only; Haiku has no server-side fallback.
    ...(isSonnet ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  } as Anthropic.Beta.MessageCreateParamsNonStreaming;

  const started = Date.now();
  let response: Anthropic.Beta.BetaMessage;
  if (onAnswerDelta && streamingEnabled()) {
    try {
      // Eager input streaming makes the API send final_answer's input as it is generated instead of in a few large
      // pieces. Streaming path only; the fallback below uses the unmodified params.
      const streamParams = {
        ...params,
        tools: tools.map((t) => (t.name === "final_answer" ? { ...t, eager_input_streaming: true } : t)),
      } as Anthropic.Beta.MessageCreateParamsNonStreaming;
      response = await streamModel(streamParams, { timeout: timeoutMs, maxRetries: 1, signal }, onAnswerDelta, onParts);
    } catch (err) {
      if (signal?.aborted) throw err;
      // Streaming must never break a request: retry once the original way, within the remaining time budget.
      const remaining = timeoutMs - (Date.now() - started);
      console.warn("[agent] streaming call failed, retrying without streaming:", err instanceof Error ? err.message : err);
      if (remaining < MIN_CALL_MS) throw err;
      response = await getClient().beta.messages.create(params, { timeout: remaining, maxRetries: 1, signal });
    }
  } else {
    response = await getClient().beta.messages.create(params, { timeout: timeoutMs, maxRetries: 1, signal });
  }

  if (process.env.NODE_ENV !== "production") {
    const u = response.usage;
    console.log(
      `[agent] usage in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
    );
  }
  return response;
}

export async function runAgent(
  question: string,
  onStep: (step: TraceStep) => void,
  signal?: AbortSignal, // aborted when the user disconnects: stop spending tokens
  priorContext = "", // formatted earlier turns of the thread (context only, never evidence); "" for a new thread
  onAnswerDelta?: (text: string) => void, // provisional preview of the final answer prose; the returned result is the truth
  onAnswerExtras?: (extras: AnswerExtras) => void, // verified tables rows, sources and follow-ups written so far (preview only)
): Promise<AgentResult> {
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const ctx = createToolContext();
  const trace: TraceStep[] = [];
  const emit = (step: TraceStep) => {
    trace.push(step);
    try {
      onStep(step);
    } catch (err) {
      // A broken listener (for example a closed stream) must not stop the run.
      console.error("[agent] onStep listener failed:", err instanceof Error ? err.message : err);
    }
  };

  // Previews are verified against this run's own citation registry before they leave the loop.
  const onParts = onAnswerExtras ? (parts: PreviewParts) => onAnswerExtras(previewExtras(parts, ctx)) : undefined;

  const start = Date.now();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: buildUserMessage(question, priorContext) },
  ];
  let nudged = false;
  const maxIterations = maxIterationsFor(question); // 6, or 8 for why/driver questions

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (signal?.aborted) return failedResult("error", "Cancelled.", trace);
    const lastStep = iteration === maxIterations || Date.now() - start > DEADLINE_MS;
    const tools = lastStep ? [FINAL_ANSWER_TOOL] : ALL_TOOL_DEFINITIONS;
    if (lastStep) {
      emit({
        type: "info",
        iteration,
        text: "Writing the answer from the evidence gathered.",
      });
    }

    const callTimeout = modelCallTimeoutMs(Date.now() - start);
    if (callTimeout < MIN_CALL_MS) {
      return failedResult(
        "insufficient_data",
        "This took too long to finish. Try asking about fewer companies or metrics.",
        trace,
      );
    }

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await callModel(model, messages, tools, callTimeout, signal, onAnswerDelta, onParts);
    } catch (err) {
      return failedResult("error", userFacingApiError(err, !!signal?.aborted), trace);
    }
    // Keep the full content (including thinking blocks) unchanged for the next request.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return failedResult(
        "declined",
        "I can't help with that request. Comps answers questions about public companies' reported fundamentals.",
        trace,
      );
    }
    if (response.stop_reason === "max_tokens") {
      return failedResult(
        "insufficient_data",
        "The answer ran too long. Try asking about fewer companies or metrics.",
        trace,
      );
    }

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        emit({ type: "thought", iteration, text: block.text.trim() });
      }
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );

    const final = toolUses.find((t) => t.name === "final_answer");
    if (final) {
      const input = (final.input ?? {}) as Record<string, unknown>;
      if (typeof input.thought === "string" && input.thought.trim()) {
        emit({ type: "thought", iteration, text: input.thought.trim() });
      }
      const answer = resolveFinalAnswer(input, ctx, question);
      // Only real answers count as successes, so clarifications, refusals and
      // "not covered" replies never use up one of the user's questions.
      return { status: answer.kind === "answer" ? "success" : "failed", answer, trace };
    }

    if (!toolUses.length) {
      // On the last step there is no later iteration to retry in, so use the model's text as the reply.
      if (!nudged && !lastStep) {
        nudged = true;
        messages.push({
          role: "user",
          content: "Please submit your response by calling the final_answer tool.",
        });
        continue;
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return failedResult(
        "insufficient_data",
        text || "I couldn't put together an answer. Please try rephrasing your question.",
        trace,
      );
    }

    // Thought + Action for every call, then run them in parallel.
    for (const t of toolUses) {
      const input = (t.input ?? {}) as { thought?: unknown };
      if (typeof input.thought === "string" && input.thought.trim()) {
        emit({ type: "thought", iteration, text: input.thought.trim() });
      }
      const def = TOOL_BY_NAME.get(t.name);
      let label = t.name;
      try {
        label = def ? def.label(t.input) : t.name;
      } catch {
        // malformed input: executeTool will report it
      }
      emit({ type: "action", iteration, id: t.id, tool: t.name as ToolName, label, input: t.input });
    }

    // Tools that outlive the budget are reported to the model as failed so the final call still has time.
    const budget = toolPhaseBudgetMs(Date.now() - start);
    const results = await Promise.all(toolUses.map((t) => withBudget(executeTool(t.name, t.input, ctx, signal), budget)));

    const toolResultBlocks: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t, i) => {
      const r = results[i];
      emit({
        type: "observation",
        iteration,
        id: t.id,
        tool: t.name as ToolName,
        ok: r.ok,
        summary: r.ok ? r.summary : r.error,
        ...(r.ok && SMALL_DATA_TOOLS.has(t.name as ToolName) ? { data: r.data } : {}),
      });
      return {
        type: "tool_result",
        tool_use_id: t.id,
        is_error: !r.ok,
        content: r.ok ? (r.forModel ?? JSON.stringify(r.data)) : r.error,
      };
    });

    const nextIsLast = iteration + 1 === maxIterations || Date.now() - start > DEADLINE_MS;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...toolResultBlocks];
    if (nextIsLast) {
      content.push({
        type: "text",
        text: "Call final_answer now using the evidence gathered. State what is established, what the sources support, and what remains uncertain (for example \"I did not find reliable evidence explaining ...\"). Never mention steps, budgets, time limits, or what you did not get to search.",
      });
    }
    // All tool_results go in ONE user message.
    messages.push({ role: "user", content });
  }

  return failedResult(
    "insufficient_data",
    "I couldn't finish this question. Try asking about fewer companies or metrics.",
    trace,
  );
}
