// Offline (no database, no LLM): usage boundary math from lib/usage.ts against an in-memory runs table.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-usage.ts
import { checkUsage, nextUtcMidnight, usageDenialBody, type UsageStore } from "../lib/usage";
import type { Plan } from "../lib/plans";

type Row = { user_id: string; status: "success" | "failed"; created_at: Date };

// Applies the same filters as the Supabase query in supabaseUsageStore.
function fakeStore(plan: Plan, rows: Row[]): UsageStore {
  return {
    getPlan: async () => plan,
    countSuccessfulRuns: async (userId, since) =>
      rows.filter((r) => r.user_id === userId && r.status === "success" && (!since || r.created_at >= since)).length,
  };
}

const NOW = new Date("2026-10-19T15:30:00Z");
const U = "user-1";
const rows = (n: number, status: Row["status"], at: Date): Row[] =>
  Array.from({ length: n }, () => ({ user_id: U, status, created_at: at }));
const YESTERDAY = new Date("2026-10-18T23:59:59Z");
const TODAY_START = new Date("2026-10-19T00:00:00Z");

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
}

async function main() {
  let r = await checkUsage(U, fakeStore("free", []), NOW);
  check("U01 free/0 allowed, 3 remaining", r.allowed && r.remaining === 3 && r.used === 0 && r.code === null, r);

  r = await checkUsage(U, fakeStore("free", rows(2, "success", NOW)), NOW);
  check("U02 free/2 allowed, 1 remaining", r.allowed && r.remaining === 1, r);

  r = await checkUsage(U, fakeStore("free", rows(3, "success", NOW)), NOW);
  check("U03 free/3 denied FREE_LIMIT_REACHED", !r.allowed && r.code === "FREE_LIMIT_REACHED" && r.remaining === 0 && r.resetAt === null, r);

  r = await checkUsage(U, fakeStore("free", [...rows(2, "success", NOW), ...rows(5, "failed", NOW)]), NOW);
  check("U04 failed rows ignored (2 success + 5 failed)", r.allowed && r.used === 2, r);

  r = await checkUsage(U, fakeStore("free", [...rows(3, "success", new Date("2026-01-01T00:00:00Z"))]), NOW);
  check("free has no time filter (old successes count)", !r.allowed && r.used === 3, r);

  r = await checkUsage(U, fakeStore("pro", rows(24, "success", NOW)), NOW);
  check("U05 pro/24 today allowed, 1 remaining", r.allowed && r.remaining === 1 && r.limit === 25, r);

  r = await checkUsage(U, fakeStore("pro", rows(25, "success", NOW)), NOW);
  check("U06 pro/25 today denied DAILY_LIMIT_REACHED with resetAt", !r.allowed && r.code === "DAILY_LIMIT_REACHED" && r.resetAt === "2026-10-20T00:00:00.000Z", r);

  r = await checkUsage(U, fakeStore("pro", [...rows(25, "success", YESTERDAY), ...rows(3, "success", NOW)]), NOW);
  check("yesterday's rows not counted for Pro", r.allowed && r.used === 3, r);

  r = await checkUsage(U, fakeStore("pro", [...rows(25, "success", TODAY_START)]), NOW);
  check("row exactly at 00:00:00Z counts as today", !r.allowed && r.used === 25, r);

  r = await checkUsage(U, fakeStore("pro", [...rows(30, "success", NOW)]), NOW);
  check("remaining clamped at 0", r.remaining === 0 && !r.allowed, r);

  r = await checkUsage(U, fakeStore("pro", [...rows(10, "success", NOW), ...rows(30, "failed", NOW)]), NOW);
  check("pro failed rows ignored", r.allowed && r.used === 10, r);

  check("reset = next UTC midnight", nextUtcMidnight(NOW).toISOString() === "2026-10-20T00:00:00.000Z");
  check("reset across month end", nextUtcMidnight(new Date("2026-10-31T23:59:59Z")).toISOString() === "2026-11-01T00:00:00.000Z");
  check("reset across year end", nextUtcMidnight(new Date("2026-12-31T12:00:00Z")).toISOString() === "2027-01-01T00:00:00.000Z");

  const denial = usageDenialBody(await checkUsage(U, fakeStore("free", rows(3, "success", NOW)), NOW));
  check(
    "402 body shape (PLAN-004)",
    denial.code === "FREE_LIMIT_REACHED" &&
      typeof denial.error === "string" &&
      denial.usage.plan === "free" && denial.usage.used === 3 && denial.usage.limit === 3 &&
      denial.usage.remaining === 0 && denial.usage.resetAt === null,
    denial,
  );

  const unl: UsageStore = { ...fakeStore("free", rows(50, "success", NOW)), isUnlimited: async () => true };
  r = await checkUsage(U, unl, NOW);
  check("unlimited account allowed past the Free limit", r.allowed && r.unlimited && r.code === null, r);
  r = await checkUsage(U, { ...fakeStore("free", rows(3, "success", NOW)), isUnlimited: async () => false }, NOW);
  check("non-listed account still limited", !r.allowed && !r.unlimited, r);

  let threw = false;
  try {
    await checkUsage(U, { getPlan: async () => "free", countSuccessfulRuns: async () => { throw new Error("db down"); } }, NOW);
  } catch { threw = true; }
  check("store error propagates (fails closed, never 'allowed')", threw);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
void main();
