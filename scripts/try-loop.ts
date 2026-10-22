// Offline checks for the loop (I3, I4) with a mocked Anthropic endpoint: no API key, no cost.
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.LLM_MODEL = "claude-haiku-5-5";
process.env.AGENT_STREAMING = "off"; // the mock below answers plain JSON; streaming has its own test (try-streaming.ts)

import { modelCallTimeoutMs, runAgent, toolPhaseBudgetMs } from "../lib/agent/loop";
import { isDriverAnalysis, maxIterationsFor } from "../lib/agent/intent";

type Reply = { content: unknown[]; stop_reason: string };
let calls: { tools: string[]; lastUser: string }[] = [];
let script: Reply[] = [];
let failStatus = 0; // when set, the mocked endpoint answers with this HTTP error

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!String(input).includes("/v1/messages")) throw new Error(`unexpected fetch ${String(input)}`);
  if (failStatus) {
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
      status: failStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = JSON.parse(String(init?.body));
  const lastMsg = body.messages?.[body.messages.length - 1]?.content;
  calls.push({
    tools: (body.tools ?? []).map((t: { name: string }) => t.name),
    lastUser: JSON.stringify(lastMsg ?? ""),
  });
  const reply = script[Math.min(calls.length - 1, script.length - 1)];
  return new Response(
    JSON.stringify({
      id: "msg_x", type: "message", role: "assistant", model: "m", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }, ...reply,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as typeof fetch;

const toolUse = (id: string): Reply => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name: "calculate", input: { thought: "t", calculations: [{ label: "x", expression: "1+1" }] } }],
});

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

async function main() {
  // I4: model keeps calling tools, then answers in plain text on the last step: its text must be kept.
  calls = [];
  script = [1, 2, 3, 4, 5].map((i) => toolUse(`tu_${i}`));
  script.push({ stop_reason: "end_turn", content: [{ type: "text", text: "Here is what I found so far: partial data." }] });
  let r = await runAgent("q", () => {});
  check("last step: 6 model calls", calls.length === 6, calls.length);
  check("last step: only final_answer offered", calls[5].tools.join() === "final_answer", calls[5].tools);
  check("last step: model text kept (not generic message)", r.status === "failed" && r.answer.answerMarkdown.includes("partial data"), r.answer);

  // Driver questions get 8 iterations, everything else stays at 6; the last one is always final_answer only.
  calls = [];
  script = [1, 2, 3, 4, 5, 6, 7].map((i) => toolUse(`td_${i}`));
  script.push({ stop_reason: "end_turn", content: [{ type: "text", text: "Partial driver analysis." }] });
  r = await runAgent("Why did Warner Music Group's operating margin change?", () => {});
  check("driver question: 8 model calls", calls.length === 8, calls.length);
  check("driver question: only final_answer on call 8, not before", calls[7].tools.join() === "final_answer" && calls[6].tools.length > 1, calls.map((c) => c.tools.length));
  check("driver question: forced-final nudge sent on call 7's result, free of budget wording", /Never mention steps/.test(calls[7].lastUser) && !/step limit|ran out/i.test(calls[7].lastUser), calls[7].lastUser);
  check("driver question: trace info has no 'step limit' wording", !r.trace.some((t) => t.type === "info" && /step limit/i.test(t.text)), r.trace.filter((t) => t.type === "info"));
  calls = [];
  r = await runAgent("Compare Nike and Lululemon gross margin", () => {});
  check("standard question still capped at 6 calls", calls.length === 6, calls.length);

  // intent helper
  const yes = ["Why did VF Corp's operating margin fall?", "What drove Nike's gross-margin recovery?", "What caused the slowdown in revenue?", "What explains the gap between Nike and Under Armour?", "Explain the change in Lululemon's margin", "What are the reasons for the decline?", "Has margin recovered?", "What led to the drop?", "Why has Lululemon outperformed Nike?", "What changed operationally between FY2023 and FY2025?"];
  const no = ["Compare Nike and Lululemon's revenue over five years.", "What was Nike's revenue in FY2025?", "Show five years of inventory for Under Armour", "Should I buy Nike stock?", "Write me a poem about cats", "Compare gross margin for NKE and LULU"];
  check("intent: driver wordings detected", yes.every(isDriverAnalysis), yes.filter((q) => !isDriverAnalysis(q)));
  check("intent: plain questions not detected", no.every((q) => !isDriverAnalysis(q)), no.filter(isDriverAnalysis));
  check("ceilings 8 / 6", maxIterationsFor(yes[0]) === 8 && maxIterationsFor(no[0]) === 6, [maxIterationsFor(yes[0]), maxIterationsFor(no[0])]);

  // Normal early text-only reply still gets one nudge
  calls = [];
  script = [
    { stop_reason: "end_turn", content: [{ type: "text", text: "thinking out loud" }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "f1", name: "final_answer", input: { thought: "t", kind: "off_topic", answer_markdown: "I do fundamentals.", tables: [], citations: [], follow_ups: [], notes: [] } }] },
  ];
  r = await runAgent("poem", () => {});
  check("early text-only: nudged, then off_topic", calls.length === 2 && r.answer.kind === "off_topic" && r.status === "failed", { calls: calls.length, r });

  // final_answer straight away
  calls = [];
  script = [script[1]];
  r = await runAgent("poem", () => {});
  check("direct final_answer: 1 call", calls.length === 1 && r.answer.kind === "off_topic", calls.length);

  // A throwing step listener must not break the run
  calls = [];
  r = await runAgent("poem", () => { throw new Error("listener boom"); });
  check("throwing onStep does not stop the run", r.answer.kind === "off_topic", r);

  // N7: an aborted signal stops the run before any model call
  calls = [];
  const ac = new AbortController();
  ac.abort();
  r = await runAgent("q", () => {}, ac.signal);
  check("aborted before start: no model call, kind error", calls.length === 0 && r.status === "failed" && r.answer.kind === "error", { calls: calls.length, r });

  // N6: a provider failure is kind "error", not "insufficient_data"
  failStatus = 401;
  r = await runAgent("q", () => {});
  check("provider failure -> kind error with a plain message", r.status === "failed" && r.answer.kind === "error" && r.answer.answerMarkdown.includes("isn't configured"), r);
  failStatus = 0;

  // I3: time budgets
  check("model call timeout is 60s early", modelCallTimeoutMs(0) === 60_000, modelCallTimeoutMs(0));
  check("model call timeout shrinks near the hard limit", modelCallTimeoutMs(100_000) === 15_000, modelCallTimeoutMs(100_000));
  check("model call timeout < 5s late (loop gives up)", modelCallTimeoutMs(112_000) < 5_000, modelCallTimeoutMs(112_000));
  check("tool budget ~100s at start", toolPhaseBudgetMs(0) === 100_000, toolPhaseBudgetMs(0));
  check("tool budget ends 10s past the deadline", toolPhaseBudgetMs(95_000) === 5_000, toolPhaseBudgetMs(95_000));
  check("tool budget has a 3s floor", toolPhaseBudgetMs(200_000) === 3_000, toolPhaseBudgetMs(200_000));

  process.exit(failures ? 1 : 0);
}
main();
