// Live: real SEC data (and the model, when ANTHROPIC_API_KEY is set) through the audit handler.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/try-audit-live.ts NKE LULU 2024
import { handleAudit } from "../lib/audit/handler";
import { fetchCompanyData } from "../lib/audit/retrieve";

async function main() {
  const [tickerA = "NKE", tickerB = "LULU", period = "latest"] = process.argv.slice(2);
  const started = Date.now();
  const res = await handleAudit(
    { tickerA, tickerB, period },
    { getUser: async () => ({ id: "live-test" }), fetchCompany: fetchCompanyData, interpret: process.env.NO_AI ? null : undefined },
  );
  console.log(`status ${res.status} in ${Date.now() - started}ms`);
  if (!("audit" in res.body)) return console.log(res.body);
  const a = res.body.audit;
  console.log(`overall ${a.overallStatus} partial=${a.partial}: ${a.overallAssessment}`);
  for (const m of a.metrics) {
    console.log(`\n${m.label}: ${m.status} (${m.evidenceQuality}) readiness=${m.integrity?.readiness}`);
    for (const c of m.integrity?.checks ?? []) if (c.status !== "PASS") console.log(`  [${c.status}] ${c.title}${c.ticker ? ` (${c.ticker})` : ""}: ${c.finding}`);
    if (m.integrity) console.log(`  conclusion: ${m.integrity.withheldConclusionReason ?? m.integrity.allowableConclusion}\n  action: ${m.integrity.analystAction}`);
    for (const v of m.values) console.log(`  ${v.ticker} ${v.display ?? "—"} FY${v.fiscalYear} end ${v.periodEnd} src ${v.evidence.map((e) => `${e.accessionNumber} ${e.xbrlConcept} ${e.documentUrl}`).join("; ")}`);
    for (const ad of m.adjustments) console.log(`  adj[${ad.kind}] ${ad.formula} -> ${ad.outputValue}`);
    for (const c of m.caveats) console.log(`  caveat: ${c}`);
    for (const n of m.aiNotes) console.log(`  ai: ${n}`);
  }
  console.log(`\nverdict: ${a.integrity?.verdict}`);
  console.log(`AI: ${a.aiInterpretation}`);
  console.log("limitations:", a.limitations);
  console.log("checklist:", a.reviewChecklist);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
