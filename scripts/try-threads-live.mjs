// Live thread check against the dev Supabase and a running `next start -p 3100`. Makes 2 real agent calls (LLM + SEC).
// Creates two temporary users, then deletes them (their threads and runs cascade). Needs .env.local loaded:
//   node --env-file=.env.local scripts/try-threads-live.mjs
// Never prints secrets.
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, sec = process.env.SUPABASE_SECRET_KEY;
const base = process.env.BASE ?? "http://localhost:3100";
const admin = createClient(url, sec, { auth: { persistSession: false } });
const ref = new URL(url).hostname.split(".")[0];
const tag = Date.now();
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " -> " + JSON.stringify(d)}`); };
const pw = "Tmp-" + tag + "-aA1!";
const users = [];
async function mk(i) {
  const email = `thr${i}-${tag}@example.com`;
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
async function ask(u, body) {
  const res = await fetch(base + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json", cookie: u.cookie }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) return { status: res.status, json: await res.json().catch(() => null) };
  const text = await res.text();
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { status: res.status, threadId: res.headers.get("x-thread-id"), events, final: events.find((e) => e.type === "final")?.result };
}
try {
  const A = await mk(1), B = await mk(2);
  users.push(A, B);

  // Rejected requests leave no empty threads.
  const bad = await ask(A, { question: "" });
  const badThread = await ask(A, { question: "Nike gross margin", threadId: "not-a-uuid" });
  const { count: c0 } = await admin.from("threads").select("id", { count: "exact", head: true }).eq("user_id", A.id);
  check("invalid question -> 400, no thread", bad.status === 400 && c0 === 0, [bad.status, c0]);
  check("malformed threadId -> 404", badThread.status === 404, badThread.status);

  // New conversation.
  const r1 = await ask(A, { question: "What was Nike's gross margin in its latest fiscal year?" });
  check("first ask streams a final", r1.status === 200 && !!r1.final, r1.status);
  check("X-Thread-Id returned", !!r1.threadId, r1.threadId);
  const { data: t1 } = await admin.from("threads").select("*").eq("user_id", A.id);
  check("exactly one thread created", t1?.length === 1 && t1[0].id === r1.threadId, t1?.length);
  check("thread title = question", t1?.[0]?.title === "What was Nike's gross margin in its latest fiscal year?", t1?.[0]?.title);
  const firstUpdated = t1?.[0]?.updated_at;
  console.log("  run 1 kind:", r1.final?.answer.kind, "status:", r1.final?.status);

  // Continuation.
  await new Promise((r) => setTimeout(r, 1200));
  const r2 = await ask(A, { question: "How does that compare with Under Armour?", threadId: r1.threadId });
  check("follow-up streams a final", r2.status === 200 && !!r2.final, r2.status);
  check("follow-up keeps the same thread", r2.threadId === r1.threadId, [r2.threadId, r1.threadId]);
  const { data: runs } = await admin.from("runs").select("id, thread_id, user_id, status, trace, created_at").eq("user_id", A.id).order("created_at");
  check("two runs attached to the one thread", runs?.length === 2 && runs.every((r) => r.thread_id === r1.threadId), runs?.map((r) => r.thread_id));
  const { data: t2 } = await admin.from("threads").select("*").eq("user_id", A.id);
  check("still one thread; updated_at advanced", t2?.length === 1 && t2[0].updated_at > firstUpdated, [t2?.length, firstUpdated, t2?.[0]?.updated_at]);
  const stepsOf = (r) => r.trace?.steps ?? [];
  const fetched = stepsOf(runs[1]).some((s) => s.type === "action" && s.tool === "get_financials");
  const a2 = r2.final?.answer;
  console.log("  run 2 kind:", a2?.kind, "| tools:", [...new Set(stepsOf(runs[1]).filter((s) => s.type === "action").map((s) => s.tool))].join(","), "| sources:", a2?.sources?.length);
  check("follow-up re-fetched evidence (get_financials ran in run 2)", fetched);
  check("follow-up citations come from this run's own sources", a2?.kind !== "answer" || (a2.sources.length > 0 && a2.sources.every((s) => s.url.startsWith("http"))), a2?.sources);
  check("follow-up understood the reference (mentions Under Armour and Nike)", /under armour/i.test(a2?.answerMarkdown ?? "") && /nike/i.test(a2?.answerMarkdown ?? ""), a2?.answerMarkdown?.slice(0, 200));

  // Usage independence: counted per successful run.
  const succ = runs.filter((r) => r.status === "success").length;
  console.log("  successful runs:", succ);
  check("usage rows are runs, not threads", runs.length === 2 && succ <= 2);

  // Security.
  const bAsk = await ask(B, { question: "Nike gross margin", threadId: r1.threadId });
  check("other user cannot continue thread -> 404", bAsk.status === 404, bAsk.status);
  const { count: bRuns } = await admin.from("runs").select("id", { count: "exact", head: true }).eq("user_id", B.id);
  check("rejected continuation saved nothing for B", bRuns === 0, bRuns);
  const bSees = await B.client.from("threads").select("id").eq("id", r1.threadId);
  check("RLS: B cannot read A's thread", !bSees.error && bSees.data.length === 0, bSees);
  const bInsert = await B.client.from("threads").insert({ user_id: A.id, title: "forged" });
  check("RLS: B cannot insert a thread for A", !!bInsert.error, bInsert);
  const bUpd = await B.client.from("threads").update({ title: "hijack" }).eq("id", r1.threadId).select();
  check("RLS: B cannot update A's thread", !bUpd.error && bUpd.data.length === 0, bUpd);
  const bDel = await B.client.from("threads").delete().eq("id", r1.threadId).select();
  check("no delete grant for users", !!bDel.error || bDel.data.length === 0, bDel);
  const aOwn = await A.client.from("threads").insert({ user_id: A.id, title: "own insert" }).select();
  check("A can insert own thread", !aOwn.error && aOwn.data?.length === 1, aOwn.error);
  if (aOwn.data?.[0]) await admin.from("threads").delete().eq("id", aOwn.data[0].id);

  // Pages.
  // The list renders after hydration, so check the exact query listThreads() runs (cookie client, RLS) instead of HTML.
  const list = await A.client.from("threads").select("id, title, created_at, updated_at, runs(count)").eq("user_id", A.id).order("updated_at", { ascending: false });
  check("history query: one thread with run count 2", !list.error && list.data.length === 1 && list.data[0].runs?.[0]?.count === 2, list.error ?? list.data);
  const page = await get(`/history/${r1.threadId}`, A);
  const html = await page.text();
  check("thread page renders both questions", page.status === 200 && html.includes("How does that compare with Under Armour?") && html.includes("latest fiscal year"), page.status);
  const other = await (await get(`/history/${r1.threadId}`, B)).text();
  check("other user's thread page shows not-found", other.includes("Research not found") && !other.includes("Under Armour"));
  const listB = await B.client.from("threads").select("id, runs(count)").eq("user_id", B.id);
  check("B's history query empty", !listB.error && listB.data.length === 0, listB);
} catch (e) {
  fails++;
  console.log("ERROR", e?.message ?? e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log(fails ? `\n${fails} FAILED` : "\nAll live thread checks passed");
  process.exit(fails ? 1 : 0);
}
