import { lookupTicker } from "../lib/agent/tools/lookupTicker";

const ctx = {
  registerFiling() {},
  registerNews: () => "news-1",
  registerFigure() {},
  ambiguous: null,
  registerAmbiguous() {},
  figures: new Map(),
  periodEnds: new Map(),
  citations: new Map(),
};
const queries: [string, string][] = [
  ["Nike", "match NKE"],
  ["NKE", "match NKE"],
  ["Nikee", "match NKE"],
  ["lululemon", "match LULU"],
  ["Under Armour", "match UAA/UA, one CIK"],
  ["Apple", "match AAPL"],
  ["VF Corp", "match VFC (SEC spells it V F CORP)"],
  ["Skechers", "not_found (left the SEC list)"],
  ["Delta", "ambiguous"],
  ["Adidas", "not_found"],
  ["xyzfakeco", "not_found"],
];

async function main() {
for (const [query, expected] of queries) {
  const r = await lookupTicker.run({ thought: "test", query }, ctx);
  if (!r.ok) throw new Error(r.error);
  const d = r.data as { status: string; candidates: { ticker: string; name: string; confidence: number }[] };
  const top = d.candidates[0];
  console.log(
    `${query.padEnd(14)} -> ${d.status.padEnd(10)} ${top ? `${top.ticker} ${top.name} (${top.confidence})` : ""}   [expect: ${expected}]`,
  );
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
