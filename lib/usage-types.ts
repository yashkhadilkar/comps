// Usage shapes shared by the server (lib/usage.ts, /api/agent) and the browser (ask form, plan badge).
// Type-only on purpose: nothing here may import server-only code.
import type { Plan } from "./plans";

export type UsageCode = "FREE_LIMIT_REACHED" | "DAILY_LIMIT_REACHED";

export type UsageResult = {
  allowed: boolean;
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  code: UsageCode | null;
  message: string | null;
  resetAt: string | null; // ISO timestamp of the next UTC midnight; Pro only
  unlimited: boolean; // dev/test accounts listed in UNLIMITED_USER_EMAILS; never true in production unless set
};

// The `usage` object inside the HTTP 402 body (SPEC PLAN-004).
export type UsageDenial = {
  error: string;
  code: UsageCode;
  usage: Pick<UsageResult, "plan" | "used" | "limit" | "remaining" | "resetAt">;
};
