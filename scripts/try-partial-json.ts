// Offline: the partial final_answer JSON extractor (lib/agent/partialJson.ts). Run: npx tsx scripts/try-partial-json.ts
import { extractAnswerMarkdown, extractPreviewParts, stripMarkersForDraft } from "../lib/agent/partialJson";
import { createToolContext, previewExtras } from "../lib/agent/tools";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

const text = 'Nike "gross" margin\nrose to 44.6% [1] \\ path/é — 😀 and <b>tag</b>\tend. {"answer_markdown":"fake"}';
const doc = JSON.stringify({ thought: 'said "answer_markdown": "x"', kind: "answer", answer_markdown: text, tables: [], citations: [{ n: 1, key: "k" }] });
const full = extractAnswerMarkdown(doc);
check("full document decodes exactly", full === text, full);

// Every prefix: result is null, or a prefix of the final text (never garbage), and grows monotonically.
let prev = "";
let bad: unknown = null;
let sawNull = false;
for (let i = 0; i <= doc.length; i++) {
  const r = extractAnswerMarkdown(doc.slice(0, i));
  if (r === null) { sawNull = true; if (prev) bad = { i, r, prev }; continue; }
  if (!text.startsWith(r)) bad = { i, r };
  if (r.length < prev.length) bad = { i, shrank: [prev, r] };
  prev = r;
}
check("every prefix is null or a monotonic prefix of the final text", bad === null && sawNull, bad);

// Unicode escapes (ASCII-escaped JSON as some serializers emit), incl. surrogate pair split mid-escape.
const esc = '{"kind":"answer","answer_markdown":"caf\\u00e9 \\ud83d\\ude00 ok"}';
check("\\u escapes decode", extractAnswerMarkdown(esc) === "café 😀 ok", extractAnswerMarkdown(esc));
const cut = (n: number) => extractAnswerMarkdown(esc.slice(0, esc.indexOf("\\ud83d") + n));
check("incomplete \\u held back", cut(3) === "café " && cut(5) === "café ", [cut(3), cut(5)]);
check("lone high surrogate held until pair completes", cut(6) === "café " && cut(10) === "café " && cut(11) === "café ", [cut(6), cut(10)]);
check("surrogate pair emitted whole", cut(12) === "café 😀", cut(12));
check("dangling backslash held back", extractAnswerMarkdown('{"answer_markdown":"a\\') === "a");
check("escaped quote not treated as the end", extractAnswerMarkdown('{"answer_markdown":"say \\"hi') === 'say "hi');
check("closing quote ends the value", extractAnswerMarkdown('{"answer_markdown":"done","tables":["x"') === "done");
check("value not started yet -> empty string", extractAnswerMarkdown('{"kind":"answer","answer_markdown":"') === "");
check("key not present -> null", extractAnswerMarkdown('{"thought":"hel') === null && extractAnswerMarkdown("") === null);
check("key name inside another string is ignored", extractAnswerMarkdown('{"thought":"the \\"answer_markdown\\": \\"x\\"","kind":"a') === null);
check("invalid escape stops safely", extractAnswerMarkdown('{"answer_markdown":"ab\\qcd"}') === "ab");
check("malformed \\u stops safely", extractAnswerMarkdown('{"answer_markdown":"ab\\uZZZZcd"}') === "ab");
check("whitespace around colon ok", extractAnswerMarkdown('{"answer_markdown" :  "hi') === "hi");

check("markers hidden in drafts", stripMarkersForDraft("Margin 44.6% [1] and 55% [news-2], also [0000320187-24-000039]. Keep [text].") === "Margin 44.6% and 55%, also. Keep [text].", stripMarkersForDraft("Margin 44.6% [1] and 55% [news-2], also [0000320187-24-000039]. Keep [text]."));


// ---- Preview parts: completed tables rows, citations, follow-ups from partial JSON ----
const full2 = {
  thought: "t",
  kind: "answer",
  answer_markdown: 'Prose with "tables": [ and {braces} \\ ok',
  tables: [
    { title: "Gross margin", columns: ["FY", "NKE", "UA"], rows: [["FY2024", "44.6% [1]", "47.0% [2]"], ["FY2023", "43.5% [1]", "—"]] },
    { title: "Revenue", columns: ["FY", "NKE"], rows: [["FY2024", "$51.36B [1]"]] },
  ],
  citations: [{ n: 1, key: "0000320187-24-000039" }, { n: 2, key: "0001336917-24-000010" }],
  follow_ups: ["What about cash flow?", "Compare with VFC?", "Inventory trend?"],
  clarification_options: [],
  notes: [],
};
const doc2 = JSON.stringify(full2);
const fp = extractPreviewParts(doc2);
check("full doc: 2 tables, rows, citations, follow-ups", fp.tables.length === 2 && fp.tables[0].rows.length === 2 && fp.tables[1].rows[0][1] === "$51.36B [1]" && fp.citations.length === 2 && fp.followUps.length === 3, fp);
check("table header decoded", fp.tables[0].title === "Gross margin" && fp.tables[0].columns?.join() === "FY,NKE,UA");
check("decoy key inside prose ignored", extractPreviewParts(doc2.slice(0, doc2.indexOf('"tables":[') )).tables.length === 0);

let bad2: unknown = null;
let prevRows = 0, prevCites = 0, prevFu = 0;
for (let i = 0; i <= doc2.length; i++) {
  let p;
  try { p = extractPreviewParts(doc2.slice(0, i)); } catch (e) { bad2 = { i, threw: String(e) }; break; }
  const rows = p.tables.reduce((n, t) => n + t.rows.length, 0);
  // every reported item must equal the corresponding item of the full document (complete, never partial)
  p.tables.forEach((t, ti) => {
    if (t.title !== null && t.title !== full2.tables[ti].title) bad2 = { i, title: t.title };
    if (t.columns && t.columns.join() !== full2.tables[ti].columns.join()) bad2 = { i, columns: t.columns };
    t.rows.forEach((r, ri) => { if (JSON.stringify(r) !== JSON.stringify(full2.tables[ti].rows[ri])) bad2 = { i, row: r }; });
  });
  p.citations.forEach((c, ci) => { if (JSON.stringify(c) !== JSON.stringify(full2.citations[ci])) bad2 = { i, cite: c }; });
  p.followUps.forEach((f, fi) => { if (f !== full2.follow_ups[fi]) bad2 = { i, fu: f }; });
  if (rows < prevRows || p.citations.length < prevCites || p.followUps.length < prevFu) bad2 = { i, shrank: true };
  prevRows = rows; prevCites = p.citations.length; prevFu = p.followUps.length;
}
check("every prefix: never throws, only complete items, monotonic", bad2 === null, bad2);
const midRow = doc2.slice(0, doc2.indexOf('"43.5%') + 4); // inside the 2nd row
check("a row is reported only once its array closes", extractPreviewParts(midRow).tables[0].rows.length === 1, extractPreviewParts(midRow).tables[0]);
const midCite = doc2.slice(0, doc2.indexOf('"key":"0001336917') + 12);
check("an unfinished citation is not reported", extractPreviewParts(midCite).citations.length === 1);
check("number literal at the very end is not complete", extractPreviewParts('{"citations":[{"n":12').citations.length === 0 && extractPreviewParts('{"citations":[{"n":1,"key":"k"}').citations.length === 1);
check("garbage input -> empty parts, no throw", JSON.stringify(extractPreviewParts("}{[[\"\\u12")) === JSON.stringify({ tables: [], citations: [], followUps: [] }));

// ---- previewExtras: server-side verification before anything is previewed ----
const ctx = createToolContext();
ctx.registerFiling({ key: "0000320187-24-000039", company: "NIKE, Inc.", ticker: "NKE", cik: 320187, form: "10-K", fiscalYear: 2024, periodEnd: "2024-05-31", filed: "2024-07-25", accession: "0000320187-24-000039", url: "https://www.sec.gov/Archives/x" });
ctx.registerFigure("44.6%", "0000320187-24-000039");
ctx.registerFigure("43.5%", "0000320187-24-000039");
ctx.registerFigure("$51.36B", "0000320187-24-000039");
const ex = previewExtras(extractPreviewParts(doc2), ctx);
check("verified rows pass, unverified row (47.0% never retrieved) withheld", ex.tables[0].rows.length === 1 && ex.tables[0].rows[0][0] === "FY2023" && ex.tables[0].rows[0][1] === "43.5% [1]", ex.tables[0].rows);
check("row with only retrieved figures + a dash passes", previewExtras({ tables: [{ title: "T", columns: ["a", "b"], rows: [["FY2023", "43.5% [1]"], ["FY2022", "—"]] }], citations: [], followUps: [] }, ctx).tables[0].rows.length === 2);
check("fabricated figure never leaves the server", !JSON.stringify(previewExtras({ tables: [{ title: "T", columns: ["a"], rows: [["99.9%"], ["$1.23B"]] }], citations: [], followUps: [] }, ctx)).includes("99.9"));
check("unknown citation key dropped, known key becomes a real Source", ex.sources.length === 1 && ex.sources[0].n === 1 && ex.sources[0].type === "filing" && ex.sources[0].url.startsWith("https://www.sec.gov"), ex.sources);
check("duplicate n ignored", previewExtras({ tables: [], citations: [{ n: 1, key: "0000320187-24-000039" }, { n: 1, key: "0000320187-24-000039" }], followUps: [] }, ctx).sources.length === 1);
check("table without header yet is not previewed", previewExtras({ tables: [{ title: null, columns: null, rows: [] }, { title: "T", columns: null, rows: [] }], citations: [], followUps: [] }, ctx).tables.length === 0);
check("follow-ups capped at 3", previewExtras({ tables: [], citations: [], followUps: ["a", "b", "c", "d"] }, ctx).followUps.length === 3);

check("half-arrived marker at the end is hidden", ["Margin 44.6% [", "Margin 44.6% [1", "Margin 44.6% [news-", "Margin 44.6% [news-2", "Margin 44.6% [0000320187-24"].every((t) => stripMarkersForDraft(t) === "Margin 44.6%"), ["Margin 44.6% [", "Margin 44.6% [1"].map(stripMarkersForDraft));
check("normal trailing text kept", stripMarkersForDraft("Margin [text") === "Margin [text" && stripMarkersForDraft("a b") === "a b");

console.log(failures ? `\n${failures} FAILED` : "\nAll partial JSON checks passed");
process.exit(failures ? 1 : 0);
