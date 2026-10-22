import { calculate } from "../lib/agent/tools/calculate";
import { searchNews } from "../lib/agent/tools/searchNews";

const ctx = {
  registerFiling() {},
  registerFigure() {},
  ambiguous: null,
  registerAmbiguous() {},
  figures: new Map(),
  periodEnds: new Map(),
  registerNews: (() => {
    let n = 0;
    return () => `news-${++n}`;
  })(),
  citations: new Map(),
};

async function main() {
  const r = await calculate.run(
    {
      thought: "test",
      calculations: [
        { label: "NKE FY24 gross margin %", expression: "22887000000 / 51362000000 * 100" },
        { label: "growth %", expression: "(51362000000 - 46710000000) / 46710000000 * 100" },
        { label: "CAGR %", expression: "((51362000000 / 46710000000) ^ (1 / 2) - 1) * 100" },
        { label: "sci notation", expression: "2.2887e10 / 5.1362e10" },
        { label: "divide by zero", expression: "5 / 0" },
        { label: "injection import", expression: "import({}, {})" },
        { label: "injection function", expression: "evaluate('1+1')" },
        { label: "letters", expression: "sqrt(4)" },
      ],
    },
    ctx,
  );
  console.log(JSON.stringify(r, null, 1));

  const n = await searchNews.run({ thought: "test", query: "Under Armour revenue decline 2024" }, ctx);
  if (!n.ok) console.log("NEWS ERROR", n.error);
  else {
    console.log(n.summary);
    for (const x of (n.data as { results: { citationKey: string; title: string; url: string }[] }).results) console.log(`${x.citationKey} ${x.title} -> ${x.url}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
