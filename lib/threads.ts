import "server-only";
import { MAX_PRIOR_RUNS, formatPriorContext, toPriorTurns } from "./agent/context";
import { createAdminClient } from "./supabase/admin";

// Write-side thread access for /api/agent (docs/THREADS_CONTINUATION_PLAN.md). Uses the admin client, which bypasses
// RLS, so EVERY query here filters on the authenticated user_id itself: a browser-supplied thread id is never
// trusted on its own (plan section 6). All functions throw on database errors so the route fails closed.

export const THREAD_TITLE_MAX = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isThreadId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function threadTitle(question: string): string {
  return question.trim().slice(0, THREAD_TITLE_MAX) || "Untitled research";
}

// True only if the thread exists AND belongs to this user. Missing and foreign threads are indistinguishable.
export async function userOwnsThread(userId: string, threadId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`thread lookup failed: ${error.message}`);
  return !!data;
}

export async function createThread(userId: string, question: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("threads")
    .insert({ user_id: userId, title: threadTitle(question) })
    .select("id")
    .single();
  if (error || !data) throw new Error(`thread create failed: ${error?.message ?? "no row returned"}`);
  return data.id as string;
}

// Formatted context from the thread's latest completed runs ("" when there are none). Ownership is re-checked in the
// query itself. Throws on any error: the route must not continue with partial or wrongly-scoped context.
export async function loadPriorContext(userId: string, threadId: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("runs")
    .select("question, answer, trace, status, created_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(MAX_PRIOR_RUNS);
  if (error) throw new Error(`thread context load failed: ${error.message}`);
  return formatPriorContext(toPriorTurns(data ?? []));
}

// Best effort by design (plan section 23): the caller has already saved the run. Never throws.
export async function touchThread(userId: string, threadId: string): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[threads] failed to bump updated_at:", err instanceof Error ? err.message : err);
  }
}
