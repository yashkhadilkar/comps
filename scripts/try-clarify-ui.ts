// Server-render check of the clarification UI (no browser): option buttons, the text box, no table/source chrome.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentTrace } from "../components/agent-trace";
import { AnswerView } from "../components/answer-view";
import type { AgentResult } from "../lib/agent/types";

const result: AgentResult = {
  status: "failed",
  trace: [],
  answer: {
    kind: "clarification",
    answerMarkdown: '"Delta" could be more than one company that files with the SEC. Which one do you mean?',
    tables: [{ title: "should be hidden", columns: ["a"], rows: [["1"]] }],
    sources: [],
    followUps: [],
    notes: [],
    clarification: {
      query: "Delta",
      question: "How is Delta doing?",
      options: [
        { name: "DELTA AIR LINES, INC.", ticker: "DAL", question: "How is DAL doing?" },
        { name: "DeltaSoft Corp", ticker: "DSFT", question: "How is DSFT doing?" },
      ],
    },
  },
};

let failures = 0;
function check(name: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const html = renderToStaticMarkup(createElement(AnswerView, { result, onAsk: () => {} }));
check("shows the heading naming the ambiguous query", html.includes("Which company did you mean by") && html.includes("Delta"));
check("button for each option (name and ticker)", /DELTA AIR LINES, INC\.[\s\S]*\(DAL\)/.test(html) && /DeltaSoft Corp[\s\S]*\(DSFT\)/.test(html));
check("exactly 2 option buttons + the Ask submit", (html.match(/<button/g) ?? []).length === 3);
check("text box for the exact name", html.includes('placeholder="Or type the exact company name or ticker"'));
check("Ask button disabled until something is typed", /<button[^>]*disabled[^>]*>Ask<\/button>/.test(html));
check("no table or investment-advice footer on a non-answer", !html.includes("should be hidden") && !html.includes("Not investment advice"));

const plain = renderToStaticMarkup(createElement(AnswerView, { result: { ...result, answer: { ...result.answer, clarification: undefined } }, onAsk: () => {} }));
check("clarification without options data: no buttons or text box", !plain.includes("<input") && !plain.includes("<button"));
// The step count is the number of tool calls listed (what the user sees), not rounds of the loop
const act = (iteration: number, id: string) => ({ type: "action" as const, iteration, id, tool: "lookup_ticker" as const, label: "x", input: {} });
const trace = renderToStaticMarkup(createElement(AgentTrace, { steps: [act(1, "a"), act(1, "b"), act(1, "c"), act(2, "d")], loading: false }));
check("3 parallel calls + 1 later call = 4 steps (matches the rows listed)", trace.includes("Researched in 4 steps") && (trace.match(/<li/g) ?? []).length === 4);
const one = renderToStaticMarkup(createElement(AgentTrace, { steps: [act(1, "a")], loading: false }));
check("singular: 1 step", one.includes("Researched in 1 step<") || one.includes("Researched in 1 step\""));
const live = renderToStaticMarkup(createElement(AgentTrace, { steps: [act(1, "a"), act(1, "b")], loading: true }));
check("live: shows a running step count", live.includes("Researching") && live.includes("2 steps so far"));
const liveEmpty = renderToStaticMarkup(createElement(AgentTrace, { steps: [], loading: true }));
check("live with no steps yet: no count", liveEmpty.includes("Researching") && !liveEmpty.includes("so far"));

process.exit(failures ? 1 : 0);
