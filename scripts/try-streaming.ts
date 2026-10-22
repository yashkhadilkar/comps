// Offline (mocked Anthropic endpoint, no key, no cost): progressive answer streaming through the loop and the NDJSON
// stream. Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-streaming.ts
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.LLM_MODEL = "claude-haiku-5-5";
delete process.env.AGENT_STREAMING;

import { runAgent } from "../lib/agent/loop";
import { createAgentStream, type RunRecord } from "../lib/agent/runStream";
import type { AgentEvent, AnswerExtras } from "../lib/agent/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

const PROSE = "Comps covers reported fundamentals for SEC filers, such as revenue, margins and cash flow. ".repeat(8) + 'Quote: "ok" \\ done\nline two é.';
const finalInput = {
  thought: "Off topic.",
  kind: "off_topic",
  answer_markdown: PROSE,
  tables: [{ title: "Gross margin", columns: ["FY", "NKE"], rows: [["FY2024", "$99.9B [1]"], ["FY2023", "—"]] }],
  citations: [{ n: 1, key: "0000320187-24-000039" }, { n: 2, key: "bogus-key" }],
  follow_ups: ["Next question one?", "Next question two?", "Next question three?"],
  clarification_options: [],
  notes: [],
};

type Mode = "stream" | "stream-cut" | "stream-500" | "plain-json" | "stream-badjson";
let mode: Mode = "stream";
let streamCalls = 0;
let plainCalls = 0;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function sseBody(cut: boolean): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const json = JSON.stringify(finalInput);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += 9) chunks.push(json.slice(i, i + 9));
  const frames = [
    sse("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "final_answer", input: {} } }),
    ...chunks.map((c) => sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: c } })),
    ...(cut ? [] : [
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } }),
      sse("message_stop", { type: "message_stop" }),
    ]),
  ];
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i >= frames.length) return c.close();
      await new Promise((r) => setTimeout(r, 4));
      c.enqueue(enc.encode(frames[i++]));
    },
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!String(input).includes("/v1/messages")) throw new Error(`unexpected fetch ${String(input)}`);
  const body = JSON.parse(String(init?.body));
  if (body.stream) {
    streamCalls++;
    if (mode === "stream-500") return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 500, headers: { "Content-Type": "application/json" } });
    if (mode === "plain-json") return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    if (mode === "stream-badjson") {
      return new Response(sse("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + "event: content_block_start\ndata: {not json\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(sseBody(mode === "stream-cut"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  plainCalls++;
  return new Response(
    JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", stop_sequence: null, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu1", name: "final_answer", input: finalInput }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as typeof fetch;

async function main() {
  // 1. Happy path: previews arrive before the call returns, grow monotonically, are prefixes of the final prose.
  mode = "stream"; streamCalls = 0; plainCalls = 0;
  const deltas: { t: number; text: string }[] = [];
  const extras: AnswerExtras[] = [];
  const t0 = Date.now();
  const r = await runAgent("What is the weather?", () => {}, undefined, "", (text) => deltas.push({ t: Date.now() - t0, text }), (x) => extras.push(x));
  check("final result is the validated answer", r.answer.kind === "off_topic" && r.answer.answerMarkdown === PROSE && r.status === "failed", r.answer);
  check("used the streaming call only", streamCalls === 1 && plainCalls === 0, { streamCalls, plainCalls });
  check("multiple incremental previews", deltas.length >= 3, deltas.length);
  check("previews grow and are prefixes of the final prose", deltas.every((d, i) => PROSE.startsWith(d.text) && (i === 0 || d.text.length > deltas[i - 1].text.length)));
  check("last preview is the complete prose (flush at block end)", deltas[deltas.length - 1]?.text === PROSE);
  check("throttled (<= ~10/s)", deltas.length <= Math.ceil((deltas[deltas.length - 1].t + 150) / 100) + 1, deltas.map((d) => d.t));

  const lastX = extras[extras.length - 1];
  check("extras previewed, cumulative and growing", extras.length >= 2 && extras.every((x, i) => i === 0 || x.followUps.length >= extras[i - 1].followUps.length), extras.length);
  check("extras: follow-ups and the no-figure row appear", lastX?.followUps.length === 3 && lastX.tables[0]?.rows.length === 1 && lastX.tables[0].rows[0][0] === "FY2023", lastX);
  check("extras: figure never retrieved by a tool ($99.9B) is never previewed", !JSON.stringify(extras).includes("99.9"));
  check("extras: unknown citation keys never become sources", extras.every((x) => x.sources.length === 0));

  // 2. Fallbacks: every streaming failure still yields the normal answer via the non-streaming call.
  for (const m of ["stream-500", "plain-json", "stream-badjson", "stream-cut"] as Mode[]) {
    mode = m; streamCalls = 0; plainCalls = 0;
    const seen: string[] = [];
    const res = await runAgent("q", () => {}, undefined, "", (t) => seen.push(t));
    check(`${m}: falls back and returns the answer`, res.answer.kind === "off_topic" && res.answer.answerMarkdown === PROSE && plainCalls === 1, { kind: res.answer.kind, plainCalls, streamCalls });
  }

  // 3. A throwing preview listener never breaks the run.
  mode = "stream"; streamCalls = 0; plainCalls = 0;
  const res3 = await runAgent("q", () => {}, undefined, "", () => { throw new Error("listener boom"); });
  check("throwing preview listener: answer intact", res3.answer.answerMarkdown === PROSE && plainCalls === 0, { plainCalls });

  // 4. Kill switch.
  process.env.AGENT_STREAMING = "off"; streamCalls = 0; plainCalls = 0;
  const off: string[] = [];
  const res4 = await runAgent("q", () => {}, undefined, "", (t) => off.push(t));
  check("AGENT_STREAMING=off: no stream call, no previews", streamCalls === 0 && plainCalls === 1 && off.length === 0 && res4.answer.answerMarkdown === PROSE, { streamCalls, plainCalls });
  delete process.env.AGENT_STREAMING;

  // 5. Abort: no fallback call after a cancel.
  mode = "stream"; streamCalls = 0; plainCalls = 0;
  const ac = new AbortController();
  const p = runAgent("q", () => {}, ac.signal, "", () => ac.abort());
  const res5 = await p;
  check("abort mid-stream: no non-streaming retry, not a success", plainCalls === 0 && res5.status === "failed", { plainCalls, status: res5.status });

  // 6. NDJSON: answer_delta events precede final; only the final result is saved; save happens once as success.
  mode = "stream";
  const saved: RunRecord[] = [];
  const text = await new Response(
    createAgentStream("q", {
      run: (q, onStep, signal, onDelta, onExtras) => runAgent(q, onStep, signal, "", onDelta, onExtras),
      save: async (rec) => void saved.push(rec),
    }),
  ).text();
  const events: AgentEvent[] = text.trim().split("\n").map((l) => JSON.parse(l));
  const types = events.map((e) => e.type);
  const firstFinal = types.indexOf("final");
  check("answer_extras events are sent and precede final", types.includes("answer_extras") && types.lastIndexOf("answer_extras") < firstFinal, types);
  check("answer_delta events precede a single final", types.includes("answer_delta") && types.lastIndexOf("answer_delta") < firstFinal && types.filter((t) => t === "final").length === 1 && types[types.length - 1] === "final", types);
  check("deltas are not persisted: one save, the validated answer", saved.length === 1 && saved[0].answer === PROSE && (saved[0].trace as { answer: { kind: string } }).answer.kind === "off_topic", saved);

  // 7. Stream that dies mid-answer in the NDJSON path (agent throws): error event, failed save, no success.
  const saved2: RunRecord[] = [];
  const text2 = await new Response(
    createAgentStream("q", {
      run: async (_q, _s, _sig, onDelta) => { onDelta("partial draft"); throw new Error("died"); },
      save: async (rec) => void saved2.push(rec),
    }),
  ).text();
  const ev2: AgentEvent[] = text2.trim().split("\n").map((l) => JSON.parse(l));
  check("crash after a preview: answer_delta, error, failed save (no false success)", ev2.map((e) => e.type).join() === "answer_delta,error" && saved2.length === 1 && saved2[0].status === "failed" && saved2[0].answer === null, { ev2, saved2 });

  console.log(failures ? `\n${failures} FAILED` : "\nAll streaming checks passed");
  process.exit(failures ? 1 : 0);
}
main();
