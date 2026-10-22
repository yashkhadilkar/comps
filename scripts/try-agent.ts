// Usage: npx tsx --env-file=.env.local scripts/try-agent.ts "your question"
import { runAgent } from "../lib/agent/loop";
import type { TraceStep } from "../lib/agent/types";

const DEFAULT_QUESTION =
  "Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years.";

function line(s: TraceStep) {
  switch (s.type) {
    case "thought":
      return `[${s.iteration}] THOUGHT  ${s.text}`;
    case "action":
      return `[${s.iteration}] ACTION   ${s.label}`;
    case "observation":
      return `[${s.iteration}] OBSERVE  ${s.ok ? "ok " : "ERR"} ${s.summary}`;
    case "info":
      return `[${s.iteration}] INFO     ${s.text}`;
  }
}

async function main() {
  const question = process.argv[2] ?? DEFAULT_QUESTION;
  console.log(`MODEL ${process.env.LLM_MODEL}\nQ: ${question}\n`);
  const t0 = Date.now();
  const result = await runAgent(question, (s) => console.log(line(s)));
  console.log(`\n--- ${result.status} (${result.answer.kind}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(result.answer, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
