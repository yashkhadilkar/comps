import "server-only";
import { FREE_QUESTION_LIMIT, PRO_DAILY_LIMIT, type Plan } from "./plans";
import { createAdminClient } from "./supabase/admin";
import type { UsageDenial, UsageResult } from "./usage-types";

// Usage limits (SPEC PLAN-001 to PLAN-005). Counted from the runs table, only status = 'success';
// there is no separate counter. The plan is read from profiles with the admin client, never from the browser.

// The two reads checkUsage needs. Injectable so the boundary math can be tested without a database.
export type UsageStore = {
  getPlan(userId: string): Promise<Plan>;
  // Successful runs for the user, optionally only those created at or after `since`.
  countSuccessfulRuns(userId: string, since?: Date): Promise<number>;
  // Optional: true for test accounts exempt from limits (see unlimitedEmails).
  isUnlimited?(userId: string): Promise<boolean>;
};

// Comma-separated emails in UNLIMITED_USER_EMAILS bypass limits. Server-side env only, matched against the
// email stored in profiles (never a browser-supplied value). Leave unset in production.
function unlimitedEmails(): string[] {
  return (process.env.UNLIMITED_USER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const supabaseUsageStore: UsageStore = {
  async getPlan(userId) {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(`profile lookup failed: ${error.message}`);
    return data?.plan === "pro" ? "pro" : "free";
  },
  async isUnlimited(userId) {
    const list = unlimitedEmails();
    if (list.length === 0) return false;
    const { data, error } = await createAdminClient().from("profiles").select("email").eq("id", userId).maybeSingle();
    if (error) throw new Error(`profile lookup failed: ${error.message}`);
    return !!data?.email && list.includes(data.email.trim().toLowerCase());
  },
  async countSuccessfulRuns(userId, since) {
    let query = createAdminClient()
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "success");
    if (since) query = query.gte("created_at", since.toISOString());
    const { count, error } = await query;
    if (error) throw new Error(`usage count failed: ${error.message}`);
    return count ?? 0;
  },
};

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// Pure decision from a plan and a count. Errors from the store are never turned into "allowed":
// checkUsage lets them throw so /api/agent fails closed.
export function evaluateUsage(plan: Plan, used: number, now: Date): UsageResult {
  const limit = plan === "pro" ? PRO_DAILY_LIMIT : FREE_QUESTION_LIMIT;
  const remaining = Math.max(0, limit - used);
  const allowed = used < limit;
  if (allowed) {
    return { allowed, plan, used, limit, remaining, code: null, message: null, resetAt: null, unlimited: false };
  }
  if (plan === "pro") {
    return {
      allowed,
      plan,
      used,
      limit,
      remaining,
      code: "DAILY_LIMIT_REACHED",
      message: `You've used all ${PRO_DAILY_LIMIT} questions for today. Your limit resets at midnight UTC.`,
      resetAt: nextUtcMidnight(now).toISOString(),
      unlimited: false,
    };
  }
  return {
    allowed,
    plan,
    used,
    limit,
    remaining,
    code: "FREE_LIMIT_REACHED",
    message: `You've used all ${FREE_QUESTION_LIMIT} free questions. Upgrade to Pro to keep going.`,
    resetAt: null,
    unlimited: false,
  };
}

export async function checkUsage(
  userId: string,
  store: UsageStore = supabaseUsageStore,
  now: Date = new Date(),
): Promise<UsageResult> {
  const plan = await store.getPlan(userId);
  if (await store.isUnlimited?.(userId)) {
    return { allowed: true, plan, used: 0, limit: Infinity, remaining: Infinity, code: null, message: null, resetAt: null, unlimited: true };
  }
  const used = await store.countSuccessfulRuns(userId, plan === "pro" ? utcDayStart(now) : undefined);
  return evaluateUsage(plan, used, now);
}

// Plan only, for pages that need no counts (pricing). Same authoritative source as checkUsage.
export async function getUserPlan(userId: string, store: UsageStore = supabaseUsageStore): Promise<Plan> {
  return store.getPlan(userId);
}

// Body of the HTTP 402 returned by /api/agent.
export function usageDenialBody(usage: UsageResult): UsageDenial {
  return {
    error: usage.message ?? "You've reached your usage limit.",
    code: usage.code!,
    usage: {
      plan: usage.plan,
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      resetAt: usage.resetAt,
    },
  };
}
