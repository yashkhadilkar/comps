import { createToolContext, executeTool, resolveFinalAnswer, TOOLS } from "../lib/agent/tools";

async function main() {
  const ctx = createToolContext();

  const lookup = await executeTool("lookup_ticker", { thought: "t", query: "Nike" }, ctx);
  console.log("lookup:", lookup.ok ? lookup.summary : lookup.error);

  const fin = await executeTool(
    "get_financials",
    { thought: "t", ticker: "NKE", metrics: ["revenue", "gross_profit"], years: 3 },
    ctx,
  );
  console.log("financials:", fin.ok ? fin.summary : fin.error);

  const calc = await executeTool(
    "calculate",
    { thought: "t", calculations: [{ label: "x", expression: "2 + 2" }] },
    ctx,
  );
  console.log("calc:", calc.ok ? calc.summary : calc.error);

  console.log("bad input:", await executeTool("calculate", { thought: "", calculations: [] }, ctx));
  console.log("unknown tool:", await executeTool("nope", {}, ctx));
  console.log("citations registered:", ctx.citations.size);

  // Final answer: one real key, one fake key
  const realKey = [...ctx.citations.keys()][0];
  const fa = resolveFinalAnswer(
    {
      kind: "answer",
      answer_markdown: "x [1] [2]",
      citations: [
        { n: 1, key: realKey },
        { n: 2, key: "0000000000-00-000000" },
      ],
      follow_ups: ["a", "b", "c", "d"],
    },
    ctx,
  );
  console.log("sources kept:", fa.sources.length, "notes:", fa.notes, "followUps:", fa.followUps.length);

  // Force a timeout: the tool should be retried once and return ok:false without throwing.
  const tool = TOOLS.find((t) => t.name === "calculate")!;
  const originalRun = tool.run;
  const originalTimeout = tool.timeoutMs;
  let calls = 0;
  tool.run = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 200));
    return { ok: true, summary: "never", data: null };
  };
  tool.timeoutMs = 1;
  const timed = await executeTool("calculate", { thought: "t", calculations: [] }, ctx);
  console.log("timeout result:", timed, "attempts:", calls);
  tool.run = originalRun;
  tool.timeoutMs = originalTimeout;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
