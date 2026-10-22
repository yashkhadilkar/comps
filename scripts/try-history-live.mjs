// Live RLS + render check for Research History against the dev Supabase and a running `next start -p 3100`.
// Creates two temporary users and runs, then deletes them. Needs .env.local loaded. Never prints secrets.
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, sec = process.env.SUPABASE_SECRET_KEY;
const base = process.env.BASE ?? "http://localhost:3100";
const admin = createClient(url, sec, { auth: { persistSession: false } });
const ref = new URL(url).hostname.split(".")[0];
const tag = Date.now();
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " -> " + d}`); };
const pw = "Tmp-" + tag + "-aA1!";
const users = [];
async function mk(i) {
  const email = `hist${i}-${tag}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  const c = createClient(url, pub, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password: pw });
  if (e2) throw e2;
  const v = "base64-" + Buffer.from(JSON.stringify(s.session)).toString("base64url");
  const name = `sb-${ref}-auth-token`;
  const cookie = []; for (let k = 0; k * 3000 < v.length; k++) cookie.push(`${name}.${k}=${v.slice(k * 3000, (k + 1) * 3000)}`);
  return { id: data.user.id, email, cookie: cookie.join("; "), client: c };
}
const get = (path, u) => fetch(base + path, { headers: u ? { cookie: u.cookie } : {}, redirect: "manual" });
const ans = { kind: "answer", answerMarkdown: "Nike gross margin was 44.6% [1].\n\n| a | b |\n|---|---|\n| 1 | 2 |", tables: [{ title: "TBL_UNIQUE_TITLE", columns: ["FY", "NKE"], rows: [["FY2024", "44.6%"]] }], sources: [{ n: 1, type: "filing", company: "Nike", ticker: "NKE", form: "10-K", fiscalYear: 2024, periodEnd: "2024-05-31", filed: "2024-07-25", accession: "x", url: "https://www.sec.gov/Archives/x" }], followUps: ["F1"], notes: ["NOTE_UNIQUE"] };
const stepsArr = [{ type: "thought", iteration: 1, text: "plan" }, { type: "action", iteration: 1, id: "a", tool: "get_financials", label: "Get NKE", input: {} }, { type: "observation", iteration: 1, id: "a", tool: "get_financials", ok: true, summary: "got it" }, { type: "action", iteration: 2, id: "b", tool: "calculate", label: "UNFINISHED_ACTION", input: {} }];
try {
  const A = await mk(1), B = await mk(2);
  users.push(A, B);
  const rows = [];
  const mkrow = (u, q, trace, answer, status, mins) => rows.push({ user_id: u.id, question: q, trace, answer, status, created_at: new Date(Date.now() - mins * 60000).toISOString() });
  mkrow(A, "A_OLD_QUESTION", { steps: stepsArr, answer: ans }, "x", "success", 3000);
  mkrow(A, "A_NEW_QUESTION", { steps: stepsArr, answer: ans }, "x", "success", 1);
  mkrow(A, "A_DECLINED", { steps: [], answer: { ...ans, kind: "declined", answerMarkdown: "No advice", tables: [], sources: [], notes: [], followUps: [] } }, "No advice", "failed", 5);
  mkrow(A, "A_LEGACY_NULL", "legacy-string-trace", "LEGACY_TEXT_ONLY", "success", 6);
  mkrow(A, "A_LEGACY_ARRAY", [], null, "failed", 7);
  mkrow(A, "A_CRASH", { steps: [], answer: null }, null, "failed", 8);
  mkrow(B, "B_SECRET_QUESTION", { steps: [], answer: ans }, "x", "success", 2);
  const { data: ins, error } = await admin.from("runs").insert(rows).select("id, question");
  if (error) throw error;
  const idOf = Object.fromEntries(ins.map((r) => [r.question, r.id]));

  // auth
  let r = await get("/history"); check("logged-out /history redirects to login", r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/login"), r.status);
  r = await get("/history/" + idOf.A_NEW_QUESTION); check("logged-out detail redirects", r.status >= 300 && r.status < 400, r.status);

  const before = (await admin.from("runs").select("id", { count: "exact", head: true }).eq("user_id", A.id)).count;
  // list
  r = await get("/history", A); let html = await r.text();
  check("/history 200 for owner", r.status === 200, r.status);
  check("list loaded for A through the cookie session (rows in payload, no error panel)", html.includes("A_NEW_QUESTION") && html.includes("A_OLD_QUESTION") && !html.includes("load your research history"));
  check("history page has no SSR leakage of B", !html.includes("B_SECRET_QUESTION"));
  // direct data-layer check through RLS client (what the page does)
  const { data: mine } = await A.client.from("runs").select("id, question, kind:trace->answer->>kind").order("created_at", { ascending: false }).limit(50);
  check("RLS: A sees only own 6 rows", mine.length === 6 && !mine.some((x) => x.question.startsWith("B_")), mine.map((x) => x.question));
  check("newest first", mine[0].question === "A_NEW_QUESTION" && mine[mine.length - 1].question === "A_OLD_QUESTION", mine.map((x) => x.question));
  check("kind extraction from jsonb (declined, null for legacy)", mine.find((x) => x.question === "A_DECLINED").kind === "declined" && mine.find((x) => x.question === "A_LEGACY_NULL").kind === null && mine.find((x) => x.question === "A_LEGACY_ARRAY").kind === null && mine.find((x) => x.question === "A_CRASH").kind === null, mine);
  const { data: cross } = await A.client.from("runs").select("id").eq("id", idOf.B_SECRET_QUESTION);
  check("RLS: A cannot read B's run by id", cross.length === 0);

  // detail
  r = await get("/history/" + idOf.A_NEW_QUESTION, A); html = await r.text();
  check("detail 200", r.status === 200, r.status);
  for (const s of ["A_NEW_QUESTION", "TBL_UNIQUE_TITLE", "NOTE_UNIQUE", "https://www.sec.gov/Archives/x", "Researched in 2 steps", "Get NKE", "Not completed"]) check("detail contains " + s, html.includes(s));
  check("detail has no spinner/Researching state", !html.includes(">Researching<") && !html.includes("Ask a follow-up"));
  r = await get("/history/" + idOf.A_DECLINED, A); html = await r.text(); check("declined renders panel", html.includes("make investment recommendations") && html.includes("No advice"));
  r = await get("/history/" + idOf.A_LEGACY_NULL, A); html = await r.text(); check("legacy null trace falls back to text", r.status === 200 && html.includes("LEGACY_TEXT_ONLY") && html.includes("older format"));
  r = await get("/history/" + idOf.A_LEGACY_ARRAY, A); html = await r.text(); check("legacy array trace failed renders safely", r.status === 200 && /couldn(&#x27;|')t complete/.test(html));
  r = await get("/history/" + idOf.A_CRASH, A); check("crash row renders", r.status === 200);
  r = await get("/history/" + idOf.B_SECRET_QUESTION, A); html = await r.text(); check("A opening B's run -> not found, no leak", html.includes("Research not found") && !html.includes("B_SECRET_QUESTION") && !html.includes("TBL_UNIQUE_TITLE"));
  r = await get("/history/not-a-uuid", A); html = await r.text(); check("bad id safe", r.status === 200 && html.includes("Research not found"));
  r = await get("/history/00000000-0000-0000-0000-000000000000", A); html = await r.text(); check("unknown id safe", html.includes("Research not found"));
  r = await get("/history", B); html = await r.text(); check("B list works & does not include A", r.status === 200);
  const after = (await admin.from("runs").select("id", { count: "exact", head: true }).eq("user_id", A.id)).count;
  check("opening history created no runs", before === after, [before, after]);
  r = await get("/history", A); html = await r.text(); check("sidebar has History link", html.includes('href="/history"'));
  r = await get("/pricing", A); check("pricing still 200", r.status === 200); r = await get("/", A); check("home still 200", r.status === 200);

  // 60 rows -> max 50
  const many = Array.from({ length: 55 }, (_, i) => ({ user_id: B.id, question: "B_BULK_" + i, trace: { steps: [], answer: ans }, answer: "x", status: "success", created_at: new Date(Date.now() - (10 + i) * 60000).toISOString() }));
  await admin.from("runs").insert(many);
  const { data: lim } = await B.client.from("runs").select("id").order("created_at", { ascending: false }).limit(50);
  check("limit(50) caps list", lim.length === 50);
} catch (e) { fails++; console.log("ERROR", e?.message ?? e); }
finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id); // cascades profiles -> runs
  const { count } = await admin.from("runs").select("id", { count: "exact", head: true }).in("user_id", users.map((u) => u.id));
  console.log("cleanup: leftover runs =", count);
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
