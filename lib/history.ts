import "server-only";
import { createClient } from "./supabase/server";
import { parsePersistedRun, type PersistedRun, type ThreadRow } from "./history-parse";

// Read-side access to Research History (docs/RESEARCH_HISTORY_PLAN.md) and Threads (docs/THREADS_CONTINUATION_PLAN.md). Uses the cookie-scoped Supabase client,
// so the `threads` and `runs` RLS select policies apply; the explicit user_id filter is a second
// layer. No admin key, no agent, no usage counting: this only reads rows that already exist.

export const HISTORY_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { ThreadRow };
export type ThreadRun = { id: string; question: string; createdAt: string; run: PersistedRun };
export type ThreadDetail = { id: string; title: string; runs: ThreadRun[] };

type ListRecord = { id: string; title: string; created_at: string; updated_at: string; runs: { count: number }[] | null };

// Threads, most recently active first. The run count comes from an embedded count, so no trace is downloaded.
// Threads with no saved run (created, then the request died before saving) are not listed.
export async function listThreads(userId: string, limit = HISTORY_LIMIT): Promise<{ ok: true; rows: ThreadRow[] } | { ok: false }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("threads")
      .select("id, title, created_at, updated_at, runs(count)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit)
      .returns<ListRecord[]>();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      rows: (data ?? [])
        .map((t) => ({ id: t.id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at, runCount: t.runs?.[0]?.count ?? 0 }))
        .filter((t) => t.runCount > 0),
    };
  } catch (err) {
    console.error("[history] list failed", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

type RunRecord = { id: string; question: string; answer: string | null; trace: unknown; status: string; created_at: string };

// "missing" covers an invalid id, a nonexistent thread and another user's thread alike, so ownership is never revealed.
export async function getThread(
  userId: string,
  id: string,
): Promise<{ state: "ok"; thread: ThreadDetail } | { state: "missing" } | { state: "error" }> {
  if (!UUID.test(id)) return { state: "missing" };
  try {
    const supabase = await createClient();
    const { data: thread, error } = await supabase
      .from("threads")
      .select("id, title")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle<{ id: string; title: string }>();
    if (error) throw new Error(error.message);
    if (!thread) return { state: "missing" };

    const { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("id, question, answer, trace, status, created_at")
      .eq("thread_id", id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .returns<RunRecord[]>();
    if (runsError) throw new Error(runsError.message);

    return {
      state: "ok",
      thread: {
        id: thread.id,
        title: thread.title,
        runs: (runs ?? []).map((r) => ({
          id: r.id,
          question: r.question,
          createdAt: r.created_at,
          run: parsePersistedRun(r.trace, r.answer, r.status),
        })),
      },
    };
  } catch (err) {
    console.error("[history] thread detail failed", err instanceof Error ? err.message : err);
    return { state: "error" };
  }
}
