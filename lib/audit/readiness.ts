// The readiness rule and the derivations the validator re-checks. Dependency-free on purpose: lib/audit/types.ts
// imports it, and types.ts is loaded in the browser (research panel, /audit), so nothing here may pull in the
// calculate engine or SEC code.
import type { AuditValue, CheckSeverity, CheckStatus, IntegrityCheck, Readiness, SourceBasis } from "./types";

export function checkSeverity(status: CheckStatus, critical: boolean): CheckSeverity {
  if (status === "FAIL") return "blocking";
  if (status === "CAUTION") return "material";
  if (status === "NOT_ASSESSED" && critical) return "material";
  return "informational";
}

// The only readiness rule. FAIL blocks; CAUTION or an unassessed critical check needs review; otherwise READY.
// Noncritical NOT_ASSESSED checks are coverage limits (listed), not reasons to withhold.
export function reduceReadiness(checks: IntegrityCheck[]): Readiness {
  if (checks.some((c) => c.status === "FAIL")) return "BLOCKED";
  if (checks.some((c) => c.status === "CAUTION" || (c.status === "NOT_ASSESSED" && c.critical))) return "REVIEW";
  return "READY";
}

export const sourceBasisOf = (v: AuditValue): SourceBasis =>
  v.normalizedValue !== null ? "DERIVED" : v.reportedValue !== null ? "DIRECT_REPORTED" : "UNAVAILABLE";
