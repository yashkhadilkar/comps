import { getFinancials } from "../lib/agent/tools/getFinancials";
import type { FilingMeta, NewsMeta } from "../lib/agent/tools/types";

const citations = new Map<string, FilingMeta | NewsMeta>();
const ctx = {
  registerFiling(m: Omit<FilingMeta, "type">) {
    citations.set(m.key, { type: "filing", ...m });
  },
  registerNews: () => "news-1",
  registerFigure() {},
  ambiguous: null,
  registerAmbiguous() {},
  figures: new Map(),
  periodEnds: new Map(),
  citations,
};

async function main() {
  for (const ticker of ["NKE", "LULU", "UAA"]) {
    const r = await getFinancials.run(
      { thought: "test", ticker, metrics: ["revenue", "gross_profit", "operating_income", "inventory"], years: 5 },
      ctx,
    );
    if (!r.ok) {
      console.log(ticker, "ERROR", r.error);
      continue;
    }
    const d = r.data as {
      company: string;
      ticker: string;
      metrics: {
        metric: string;
        note?: string;
        missingFiscalYears: number[];
        values: { fiscalYear: number; periodEnd: string; display: string; form: string; filed: string; tag: string; citationKey: string }[];
      }[];
    };
    console.log(`\n=== ${d.company} (${d.ticker}) ${r.summary}`);
    for (const m of d.metrics) {
      console.log(`  ${m.metric}${m.note ? "  NOTE: " + m.note : ""}${m.missingFiscalYears.length ? "  MISSING: " + m.missingFiscalYears : ""}`);
      for (const v of m.values) {
        console.log(`    FY${v.fiscalYear} end ${v.periodEnd}  ${v.display.padStart(10)}  ${v.form} filed ${v.filed}  ${v.tag}  ${v.citationKey}`);
      }
    }
  }
  const first = [...citations.values()][0];
  console.log("\nCitations registered:", citations.size, "\nExample URL:", first && "url" in first ? first.url : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
