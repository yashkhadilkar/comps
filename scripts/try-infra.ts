// Offline checks for N1 (SEC cache), N2 (executor retries), N3 (calculator), N4 (stale / non-USD flags).
import { NonRetryableError } from "../lib/agent/errors";
import { cacheStats, clearCacheForTests, getCached } from "../lib/agent/sec";
import { evaluateExpression } from "../lib/agent/tools/calculate";
import { nonUsdUnits, staleNote } from "../lib/agent/tools/getFinancials";
import { createToolContext, executeTool, TOOLS } from "../lib/agent/tools";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---- N1: cache
  clearCacheForTests();
  let loads = 0;
  const slow = async () => {
    loads++;
    await sleep(30);
    return { big: "x" };
  };
  await Promise.all([getCached("k", 60_000, slow), getCached("k", 60_000, slow), getCached("k", 60_000, slow)]);
  check("3 concurrent callers share 1 request", loads === 1, loads);
  await getCached("k", 60_000, slow);
  check("later call hits the cache", loads === 1, loads);

  let tries = 0;
  const flaky = async () => {
    tries++;
    if (tries === 1) throw new Error("boom");
    return 1;
  };
  await getCached("f", 60_000, flaky).catch(() => {});
  check("a failed load is not cached and leaves nothing in flight", cacheStats().inflight === 0, cacheStats());
  check("next call retries and succeeds", (await getCached("f", 60_000, flaky)) === 1 && tries === 2, tries);

  clearCacheForTests();
  await getCached("tickers", 60_000, async () => "list");
  for (let i = 0; i < 45; i++) await getCached(`facts:${i}`, 60_000, async () => i);
  check("cache is bounded", cacheStats().entries <= cacheStats().max, cacheStats());
  let tickerLoads = 0;
  await getCached("tickers", 60_000, async () => (tickerLoads++, "list"));
  check("tickers entry is never evicted", tickerLoads === 0, tickerLoads);
  let recent = 0;
  await getCached("facts:44", 60_000, async () => (recent++, 44));
  check("most recent entry survives eviction", recent === 0, recent);
  let oldest = 0;
  await getCached("facts:0", 60_000, async () => (oldest++, 0));
  check("oldest entry was evicted", oldest === 1, oldest);

  // ---- N2: executor
  const calc = TOOLS.find((t) => t.name === "calculate")!;
  const originalRun = calc.run;
  const originalTimeout = calc.timeoutMs;
  const ctx = createToolContext();
  const valid = { thought: "t", calculations: [{ label: "x", expression: "1+1" }] };

  let attempts = 0;
  calc.run = async () => {
    attempts++;
    throw new NonRetryableError("bad credentials");
  };
  let r = await executeTool("calculate", valid, ctx);
  check("non-retryable error: 1 attempt, explicit error", attempts === 1 && !r.ok && r.error.includes("bad credentials") && !r.error.includes("after a retry"), { attempts, r });

  attempts = 0;
  calc.run = async () => {
    attempts++;
    throw new Error("transient");
  };
  r = await executeTool("calculate", valid, ctx);
  check("ordinary error: retried once", attempts === 2 && !r.ok && r.error.includes("after a retry"), { attempts, r });

  const aborted: boolean[] = [];
  calc.timeoutMs = 20;
  calc.run = async (_i, _c, signal) => {
    await sleep(80);
    aborted.push(!!signal?.aborted);
    return { ok: true, summary: "late", data: null };
  };
  r = await executeTool("calculate", valid, ctx);
  await sleep(200);
  check("timed-out attempts are aborted (both)", !r.ok && aborted.length === 2 && aborted.every(Boolean), { r, aborted });
  calc.timeoutMs = originalTimeout;

  const ac = new AbortController();
  ac.abort();
  attempts = 0;
  calc.run = async () => (attempts++, { ok: true, summary: "x", data: null });
  r = await executeTool("calculate", valid, ctx, ac.signal);
  check("already-cancelled run starts nothing", attempts === 0 && !r.ok && r.error.includes("cancelled"), { attempts, r });
  calc.run = originalRun;

  // ---- N3: calculator
  check("% rejected", "error" in evaluateExpression("5 % 3"));
  check("comma rejected", "error" in evaluateExpression("max(1, 2)"));
  check("exponent notation and ^ still work", (evaluateExpression("2.5e3 / 5 + 2^3") as { result: number }).result === 508);
  check("overflow is an error", "error" in evaluateExpression("1e308 * 10"));

  // ---- N4: stale and non-USD
  const now = Date.parse("2026-10-19");
  check("recent annual figure is not stale", staleNote("2026-05-31", now) === undefined && staleNote("2025-09-30", now) === undefined);
  check("figure over 15 months old is flagged", (staleNote("2025-03-31", now) ?? "").includes("2025-03-31"), staleNote("2025-03-31", now));
  check("delisted-style old figure is flagged", !!staleNote("2019-12-31", now));
  const facts = { Revenues: { units: { CAD: [] } }, Other: { units: { USD: [], EUR: [] } } };
  check("non-USD units found", nonUsdUnits(facts, ["Revenues", "Other", "Missing"]).sort().join() === "CAD,EUR", nonUsdUnits(facts, ["Revenues", "Other"]));
  check("USD-only tags report no other units", nonUsdUnits({ A: { units: { USD: [] } } }, ["A"]).length === 0);

  process.exit(failures ? 1 : 0);
}
main();
