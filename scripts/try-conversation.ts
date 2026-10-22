// Offline (no server, no LLM): the workspace's live-turn state (components/research/conversation.ts). Earlier turns
// must stay untouched while a follow-up streams, fails or finishes. Run: npx tsx scripts/try-conversation.ts
import { applyEvent, newTurn, turnView, updateTurn, type LiveTurn } from "../components/research/conversation";
import type { AgentEvent, AgentResult } from "../lib/agent/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

function result(text: string): AgentResult {
  return {
    status: "success",
    answer: { kind: "answer", answerMarkdown: text, tables: [], sources: [], followUps: ["Next?"], notes: [] },
    trace: [],
  } as unknown as AgentResult;
}

// Mirrors AskForm: append a turn, then fold each NDJSON event into that turn only.
let turns: LiveTurn[] = [];
const ask = (id: string, q: string) => (turns = [...turns, newTurn(id, q)]);
const send = (id: string, event: AgentEvent) => (turns = updateTurn(turns, id, (t) => applyEvent(t, event)));
const drain = (id: string) => (turns = updateTurn(turns, id, (t) => ({ ...t, draftDone: true })));
const step = (text: string): AgentEvent => ({ type: "step", step: { type: "thought", iteration: 1, text } } as AgentEvent);

// Turn A completes.
ask("a", "Compare Nike and Lululemon's revenue growth.");
send("a", step("A thinking"));
send("a", { type: "answer_delta", text: "Nike grew" });
send("a", { type: "answer_extras", tables: [], sources: [], followUps: ["Why did Nike underperform?"] });
check("A preview visible while writing", turnView(turns[0]).previewVisible && !turnView(turns[0]).resultVisible);
send("a", { type: "final", result: result("A answer") });
check("A result held until the preview drains", !turnView(turns[0]).resultVisible && turnView(turns[0]).previewVisible);
drain("a");
check("A result visible after drain, preview gone", turnView(turns[0]).resultVisible && !turnView(turns[0]).previewVisible);
const doneA = turns[0];

// Follow-up B streams: A must stay the same object throughout (Test 1 / Test 2 share this path).
ask("b", "Why did Nike underperform?");
check("B appended below A", turns.length === 2 && turns[0] === doneA && turns[1].question === "Why did Nike underperform?");
const events: AgentEvent[] = [
  step("B thinking"),
  { type: "answer_delta", text: "Because" },
  { type: "answer_delta", text: "Because inventory" },
  { type: "answer_extras", tables: [], sources: [], followUps: [] },
  { type: "final", result: result("B answer") },
];
let aStable = true;
for (const e of events) {
  send("b", e);
  if (turns[0] !== doneA || !turnView(turns[0]).resultVisible) aStable = false;
}
check("A untouched and visible during every B event", aStable);
check("B has its own trace and draft", turns[1].steps.length === 1 && turns[1].draftAnswer === "Because inventory");
check("answer_delta never touches A", doneA.draftAnswer === "Nike grew" && doneA.steps.length === 1);
drain("b");
check("B finalized, A still has its own result", turns[1].result !== doneA.result && turnView(turns[1]).resultVisible);

// Three turns: C fails mid-stream (Test 3 + Test 5).
ask("c", "How does this affect operating margins?");
send("c", step("C thinking"));
send("c", { type: "answer_delta", text: "Margins" });
send("c", { type: "error", message: "Research failed" });
check("three turns in order", turns.map((t) => t.id).join() === "a,b,c");
check("failure attached only to C", turns[2].runError === "Research failed" && !turns[0].runError && !turns[1].runError);
check("C's draft cleared on error, no preview", turns[2].draftAnswer === "" && !turnView(turns[2]).previewVisible);
check("A and B still visible after C fails", turnView(turns[0]).resultVisible && turnView(turns[1]).resultVisible);

// A turn that never got a response (network error / 402) has no answer and no preview.
ask("d", "Another question");
turns = updateTurn(turns, "d", (t) => ({ ...t, runError: "Couldn't reach the server." }));
check("pre-stream failure isolated", turns.length === 4 && turns[3].runError !== null && turns.slice(0, 2).every((t) => turnView(t).resultVisible));

// Unknown ids and late events are no-ops for other turns.
const before = turns;
send("zzz", { type: "final", result: result("stray") });
check("event for an unknown turn changes nothing", turns.every((t, i) => t === before[i]));

// A result with no preview (non-streaming fallback) shows immediately.
const plain = applyEvent(newTurn("e", "q"), { type: "final", result: result("x") });
check("final without preview is visible at once", turnView(plain).resultVisible && !turnView(plain).previewVisible);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
