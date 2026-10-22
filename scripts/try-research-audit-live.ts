// Live: real agent + real SEC data through createAgentStream with the comparability enrichment (no database).
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/try-research-audit-live.ts "Compare ..."
import { runAgent } from "../lib/agent/loop";
import { createAgentStream } from "../lib/agent/runStream";
import type { AgentEvent } from "../lib/agent/types";
import { runResearchAudit } from "../lib/audit/research";
import { fetchCompanyData } from "../lib/audit/retrieve";

async function main() {
  const question = process.argv[2] ?? "Compare Nike and Under Armour on revenue, profitability, margins and growth. Highlight the biggest differences.";
  const t0 = Date.now();
  let finalAt = 0;
  const stream = createAgentStream(question, {
    run: (q, onStep, signal, d, x) => runAgent(q, onStep, signal, "", d, x),
    save: async () => {},
    audit: (result, signal) => runResearchAudit(result, fetchCompanyData, { signal }),
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const ev = JSON.parse(buf.slice(0, i)) as AgentEvent;
      buf = buf.slice(i + 1);
      if (ev.type === "final") {
        finalAt = Date.now();
        const a = ev.result.answer;
        console.log(`final at ${((finalAt - t0) / 1000).toFixed(1)}s kind=${a.kind} tables=${a.tables.map((t) => `${t.title}[${t.rows.map((r) => r[0]).join("|")}]`).join("; ")} sources=${a.sources.length} followUps=${a.followUps.length}`);
      } else if (ev.type === "audit") {
        console.log(`audit ${Date.now() - finalAt}ms after final (computed before save)`);
        console.log(JSON.stringify(ev.audit, null, 1));
      } else if (ev.type === "error") console.log("ERROR", ev.message);
    }
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
