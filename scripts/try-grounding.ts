// Offline checks for resolveFinalAnswer (B2): dangling markers, raw accession markers, zero sources.
import { rewriteQuestion } from "../lib/agent/clarify";
import { createToolContext, resolveFinalAnswer } from "../lib/agent/tools";

const REAL = "0000320187-24-000044";
const REAL2 = "0001397187-25-000013";
const FAKE = "0000000000-00-000000";

function ctxWith(...keys: string[]) {
  const ctx = createToolContext();
  for (const f of ["46.0%", "46%", "1%", "2%"]) ctx.registerFigure(f); // computed figures used in the cases below
  for (const key of keys) {
    ctx.registerFiling({
      key, company: "X", ticker: "X", cik: 1, form: "10-K", fiscalYear: 2024,
      periodEnd: "2024-05-31", filed: "2024-07-01", accession: key, url: `https://example.com/${key}`,
    });
  }
  return ctx;
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}

const base = { follow_ups: ["a", "b", "c"], notes: [] as string[] };

// 1. Clean answer is untouched
let r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "GM 46.0% [1]", tables: [{ title: "t", columns: ["a", "b"], rows: [["FY22", "46.0% [1]"]] }], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL),
);
check("clean answer unchanged", r.kind === "answer" && r.answerMarkdown === "GM 46.0% [1]" && r.tables[0].rows[0][1] === "46.0% [1]" && !r.notes.length, r);

// 1b. Raw news-N markers are rewritten to [n]; unknown news keys are dropped, never left as dead text
{
  const c = ctxWith(REAL);
  const nk = c.registerNews({ title: "T", url: "https://example.com/n", publishedDate: null, domain: "example.com" });
  const rr = resolveFinalAnswer(
    { ...base, kind: "answer", answer_markdown: `GM 46.0% [1]. Reported driver [${nk}]. Made up [news-77].`, tables: [], citations: [{ n: 1, key: REAL }] },
    c,
  );
  check("raw news-N marker rewritten to [n] and its source added", rr.sources.some((x) => x.type === "news") && !/news-\d/.test(rr.answerMarkdown) && /driver \[\d\]/.test(rr.answerMarkdown), rr);
  check("unknown news-N marker removed", !rr.answerMarkdown.includes("news-77"), rr.answerMarkdown);
}

// 2. Unknown key dropped, its marker removed, other source kept
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "A 1% [1] and B 2% [2].", tables: [], citations: [{ n: 1, key: REAL }, { n: 2, key: FAKE }] },
  ctxWith(REAL),
);
check("unknown key dropped + dangling [2] removed", r.sources.length === 1 && r.answerMarkdown === "A 1% [1] and B 2%." && r.notes.length === 2, r);

// 3. Raw accession markers rewritten to [n] (seen on Sonnet), in prose and table cells
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: `GM was 46% [${REAL}].`, tables: [{ title: "t", columns: ["a", "b"], rows: [["FY22", `46% [${REAL}]`]] }], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL),
);
check("raw accession marker -> [1]", r.answerMarkdown === "GM was 46% [1]." && r.tables[0].rows[0][1] === "46% [1]" && !r.notes.length, r);

// 4. Raw accession marker for a retrieved key missing from citations: source added
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: `A [1] B [${REAL2}]`, tables: [], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL, REAL2),
);
check("uncited retrieved key added as [2]", r.answerMarkdown === "A [1] B [2]" && r.sources.length === 2 && r.sources[1].n === 2, r);

// 5. Raw accession marker with an unknown key is removed
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: `A [1] B [${FAKE}]`, tables: [], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL),
);
check("unknown raw key marker removed", r.answerMarkdown === "A [1] B" && r.sources.length === 1, r);

// 6. Duplicate n keeps the first
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "A [1]", tables: [], citations: [{ n: 1, key: REAL }, { n: 1, key: REAL2 }] },
  ctxWith(REAL, REAL2),
);
check("duplicate n dropped", r.sources.length === 1 && r.sources[0].type === "filing" && r.sources[0].accession === REAL && r.notes.length === 1, r);

// 7. Answer with zero sources is downgraded; figures are not shown
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "Nike margin 46% [1]", tables: [{ title: "t", columns: ["a"], rows: [["46%"]] }], citations: [{ n: 1, key: FAKE }] },
  ctxWith(REAL),
);
check("answer + 0 valid sources -> insufficient_data", r.kind === "insufficient_data" && !r.tables.length && !r.answerMarkdown.includes("46%"), r);
r = resolveFinalAnswer({ ...base, kind: "answer", answer_markdown: "x", tables: [], citations: [] }, ctxWith());
check("answer + no citations -> insufficient_data", r.kind === "insufficient_data", r);

// 8. Non-answers with no sources are NOT altered
r = resolveFinalAnswer({ ...base, kind: "declined", answer_markdown: "Not advice.", tables: [], citations: [] }, ctxWith());
check("declined stays declined", r.kind === "declined" && r.answerMarkdown === "Not advice.", r);

// 9. Year-like brackets are not treated as markers
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "In [2024] margin was 46% [1]", tables: [], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL),
);
check("[2024] left alone", r.answerMarkdown === "In [2024] margin was 46% [1]", r);

// 10. Valid-but-wrong citation on a $ figure is repointed to the filing that reports it
{
  const ctx = ctxWith(REAL, REAL2);
  ctx.registerFigure("$46.71B", REAL2); // FY2022 revenue reported in REAL2
  r = resolveFinalAnswer(
    { ...base, kind: "answer", answer_markdown: "Revenue fell.", tables: [{ title: "t", columns: ["FY", "Rev"], rows: [["FY2022", "$46.71B [1]"]] }], citations: [{ n: 1, key: REAL }] },
    ctx,
  );
  check("wrong key on $ figure -> corrected", r.tables[0].rows[0][1] === "$46.71B [2]" && r.sources.some((x) => x.n === 2) && r.notes.some((n) => n.startsWith("Corrected 1")), r);

  r = resolveFinalAnswer(
    { ...base, kind: "answer", answer_markdown: "Revenue fell.", tables: [{ title: "t", columns: ["FY", "Rev"], rows: [["FY2022", "$46.71B"]] }], citations: [{ n: 1, key: REAL }] },
    ctx,
  );
  check("missing marker on $ figure -> added", r.tables[0].rows[0][1] === "$46.71B [2]", r);

  r = resolveFinalAnswer(
    { ...base, kind: "answer", answer_markdown: "x", tables: [{ title: "t", columns: ["FY", "Rev"], rows: [["FY2022", "$46.71B [2]"]] }], citations: [{ n: 2, key: REAL2 }] },
    ctx,
  );
  check("correct key left alone", r.tables[0].rows[0][1] === "$46.71B [2]" && !r.notes.length, r);
}

// 11. A figure no tool returned gets a warning note (answer is kept)
r = resolveFinalAnswer(
  { ...base, kind: "answer", answer_markdown: "Margin was 99.9% [1] and 46.0% [1].", tables: [], citations: [{ n: 1, key: REAL }] },
  ctxWith(REAL),
);
check("ungrounded 99.9% flagged, grounded 46.0% not", r.kind === "answer" && r.notes.length === 1 && r.notes[0].includes("99.9%") && !r.notes[0].includes("46.0%"), r);

// 12. Sign and unit differences still match ("-9.8%" registered as calc display, shown as "9.8%")
{
  const ctx = ctxWith(REAL);
  ctx.registerFigure("-9.8");
  r = resolveFinalAnswer({ ...base, kind: "answer", answer_markdown: "Fell 9.8% [1] (-9.8% growth) in FY2025 ended 2025-05-31.", tables: [], citations: [{ n: 1, key: REAL }] }, ctx);
  check("sign-insensitive match", !r.notes.length, r);
}

// 13. Differing fiscal year-ends with no dates shown -> note; with dates -> none
{
  const mk = () => {
    const ctx = ctxWith();
    for (const [t, end] of [["NKE", "2026-05-31"], ["LULU", "2026-02-01"]]) {
      ctx.registerFiling({ key: `k-${t}`, company: t, ticker: t, cik: 1, form: "10-K", fiscalYear: 2025, periodEnd: end, filed: "2026-07-01", accession: `k-${t}`, url: "u" });
    }
    return ctx;
  };
  r = resolveFinalAnswer({ ...base, kind: "answer", answer_markdown: "Both grew [1]", tables: [], citations: [{ n: 1, key: "k-NKE" }] }, mk());
  check("year-end differs, no dates -> note", r.notes.length === 1 && r.notes[0].includes("NKE 2026-05-31") && r.notes[0].includes("LULU 2026-02-01"), r);
  r = resolveFinalAnswer({ ...base, kind: "answer", answer_markdown: "Nike (ended 2026-05-31) grew [1]", tables: [], citations: [{ n: 1, key: "k-NKE" }] }, mk());
  check("year-end differs, dates shown -> no note", r.notes.length === 0, r);
  const same = ctxWith();
  for (const t of ["A", "B"]) same.registerFiling({ key: `s-${t}`, company: t, ticker: t, cik: 1, form: "10-K", fiscalYear: 2025, periodEnd: t === "A" ? "2025-12-31" : "2025-12-28", filed: "x", accession: `s-${t}`, url: "u" });
  r = resolveFinalAnswer({ ...base, kind: "answer", answer_markdown: "ok [1]", tables: [], citations: [{ n: 1, key: "s-A" }] }, same);
  check("similar year-ends (3 days apart) -> no note", r.notes.length === 0, r);
}

// 14. Ambiguity guard (AGENT-009)
{
  const Q = "How is Delta doing?";
  const cands = [
    { name: "DELTA AIR LINES, INC.", ticker: "DAL", weak: false },
    { name: "DeltaSoft Corp", ticker: "DSFT", weak: false },
    { name: "ADDENTAX GROUP CORP.", ticker: "ATXG", weak: true },
  ];
  const amb = () => {
    const ctx = ctxWith();
    ctx.registerAmbiguous("Delta", cands);
    return ctx;
  };
  const input = { ...base, kind: "answer" as const, answer_markdown: "Delta is doing well [1]", tables: [], citations: [], clarification_options: [] as { name: string; ticker: string }[] };

  // model tries to answer anyway; no options chosen -> tool's strong candidates (weak ATXG dropped)
  r = resolveFinalAnswer(input, amb(), Q);
  check("ambiguous + answer -> clarification, strong candidates", r.kind === "clarification" && r.clarification?.options.map((o) => o.ticker).join() === "DAL,DSFT" && !r.answerMarkdown.includes("doing well") && !r.sources.length && !r.followUps.length, r);
  check("option question is rewritten with the ticker", r.clarification?.options[0].question === "How is DAL doing?" && r.clarification?.query === "Delta", r.clarification);

  // model picks a subset: honored, in its order
  r = resolveFinalAnswer({ ...input, kind: "clarification", clarification_options: [{ name: "x", ticker: "dsft" }, { name: "y", ticker: "DAL" }] }, amb(), Q);
  check("model's choice and order honored (case-insensitive ticker)", r.clarification?.options.map((o) => o.ticker).join() === "DSFT,DAL", r.clarification);

  // model offers the weak look-alike (ATXG): dropped while stronger candidates exist
  r = resolveFinalAnswer({ ...input, clarification_options: [{ name: "n", ticker: "DAL" }, { name: "n", ticker: "ATXG" }] }, amb(), Q);
  check("weak fuzzy pick dropped", r.clarification?.options.map((o) => o.ticker).join() === "DAL", r.clarification);

  // model invents a ticker / wrong name: dropped, names come from the tool
  r = resolveFinalAnswer({ ...input, clarification_options: [{ name: "Totally Made Up", ticker: "ZZZZ" }, { name: "FAKE NAME", ticker: "DAL" }] }, amb(), Q);
  check("invented ticker dropped, tool name shown", r.clarification?.options.length === 1 && r.clarification.options[0].name === "DELTA AIR LINES, INC.", r.clarification);

  // only invented tickers -> fallback to tool candidates
  r = resolveFinalAnswer({ ...input, clarification_options: [{ name: "n", ticker: "ZZZZ" }] }, amb(), Q);
  check("no valid choice -> fallback candidates", r.clarification?.options.length === 2, r.clarification);

  // never more than 3
  const many = ctxWith();
  many.registerAmbiguous("X", [1, 2, 3, 4, 5].map((i) => ({ name: `N${i}`, ticker: `T${i}`, weak: false })));
  r = resolveFinalAnswer({ ...input, clarification_options: [1, 2, 3, 4, 5].map((i) => ({ name: "n", ticker: `T${i}` })) }, many, "X?");
  check("max 3 options", (r.clarification?.options.length ?? 0) <= 3, r.clarification);

  // other kinds are not hijacked; no ambiguity means no change
  r = resolveFinalAnswer({ ...input, kind: "declined", answer_markdown: "Not advice." }, amb(), Q);
  check("declined not overridden", r.kind === "declined" && !r.clarification, r);
  r = resolveFinalAnswer({ ...input, kind: "clarification", answer_markdown: "Which year?" }, ctxWith(), Q);
  check("clarification with no ambiguous lookup is untouched", r.kind === "clarification" && !r.clarification && r.answerMarkdown === "Which year?", r);

  // rewriteQuestion
  check("rewrite: possessive + case", rewriteQuestion("How is delta's revenue?", "Delta", "DAL") === "How is DAL's revenue?", rewriteQuestion("How is delta's revenue?", "Delta", "DAL"));
  check("rewrite: query not in question -> appended", rewriteQuestion("Compare airlines", "Delta", "DAL") === "Compare airlines (I mean DAL)", rewriteQuestion("Compare airlines", "Delta", "DAL"));
}

process.exit(failures ? 1 : 0);
