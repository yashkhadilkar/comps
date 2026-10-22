import type { Metadata } from "next";
import { AuditWorkspace } from "@/components/audit/audit-workspace";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "Comparability Audit · Comps" };

// Two-company financial comparability review over SEC XBRL data. Does not use research questions.
// ?a=&b=&period= prefill the form (linked from a research answer's comparability review); nothing runs until submitted.
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; period?: string }> }) {
  const { a, b, period } = await searchParams;
  const clean = (v?: string) => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 10) : "");
  return (
    <AppShell section="Comparability Audit" requireUser>
      <AuditWorkspace initial={{ tickerA: clean(a), tickerB: clean(b), period: /^\d{4}$/.test(period ?? "") ? period! : "latest" }} />
    </AppShell>
  );
}
