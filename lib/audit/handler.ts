// /api/audit request handling, independent of Next.js so auth, validation and limits can be tested offline.
// Audits do not touch research usage (runs table / plan quotas). They are bounded instead by a per-user in-memory
// rate limit, one concurrent audit per user, a hard deadline, and at most one model call per audit.
import { randomUUID } from "node:crypto";
import { buildAudit, type CompanyData } from "./engine";
import { interpretAudit, type InterpretFn } from "./interpret";
import { parseAuditRequest, validateAudit, type ComparabilityAudit } from "./types";

export const AUDIT_DEADLINE_MS = 45_000;
export const AUDITS_PER_WINDOW = 10;
export const WINDOW_MS = 60 * 60 * 1000;

export type AuditDeps = {
  getUser(): Promise<{ id: string } | null>;
  fetchCompany(ticker: string, signal: AbortSignal): Promise<CompanyData>;
  interpret?: InterpretFn | null; // null disables the model call
  now?: () => number;
};

export type AuditResponse = { status: number; body: { audit: ComparabilityAudit } | { error: string; code?: string } };

// Per-process limiter. Railway runs one instance, so this is a real bound there; it resets on deploy.
const recent = new Map<string, number[]>();
const active = new Set<string>();

export function resetLimiterForTests() {
  recent.clear();
  active.clear();
}

function takeSlot(userId: string, now: number): boolean {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= AUDITS_PER_WINDOW) {
    recent.set(userId, list);
    return false;
  }
  list.push(now);
  recent.set(userId, list);
  return true;
}

export async function handleAudit(rawBody: unknown, deps: AuditDeps, signal?: AbortSignal): Promise<AuditResponse> {
  const user = await deps.getUser();
  if (!user) return { status: 401, body: { error: "Please log in to run an audit." } };

  const parsed = parseAuditRequest(rawBody);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const now = deps.now?.() ?? Date.now();
  if (active.has(user.id)) return { status: 429, body: { error: "An audit is already running. Wait for it to finish.", code: "AUDIT_IN_PROGRESS" } };
  if (!takeSlot(user.id, now)) {
    return { status: 429, body: { error: `Audit limit reached (${AUDITS_PER_WINDOW} per hour). Try again later.`, code: "AUDIT_RATE_LIMIT" } };
  }

  active.add(user.id);
  const deadline = AbortSignal.timeout(AUDIT_DEADLINE_MS);
  const runSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const { tickerA, tickerB, period } = parsed.value;
    const [a, b] = await Promise.all([deps.fetchCompany(tickerA, runSignal), deps.fetchCompany(tickerB, runSignal)]);
    if (runSignal.aborted) return { status: 504, body: { error: "The audit took too long. Please try again." } };

    let audit = buildAudit(a, b, period, { auditId: randomUUID(), now: new Date(now) });
    const hasEvidence = audit.metrics.some((m) => m.status !== "INSUFFICIENT_EVIDENCE");
    if (deps.interpret !== null && hasEvidence) {
      const r = await interpretAudit(audit, deps.interpret ?? undefined, runSignal);
      audit = r.audit;
      if (r.error) audit.limitations.push("AI interpretation was unavailable for this audit; the deterministic findings are unaffected.");
      else if (r.dropped) audit.limitations.push(`${r.dropped} AI note(s) were dropped because they were not grounded in the retrieved evidence.`);
    }

    const errors = validateAudit(audit);
    if (errors.length) {
      console.error("[audit] contract violation:", errors);
      return { status: 500, body: { error: "The audit failed an internal consistency check. Please try again." } };
    }
    return { status: 200, body: { audit } };
  } finally {
    active.delete(user.id);
  }
}
