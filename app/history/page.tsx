import type { Metadata } from "next";
import Link from "next/link";
import { HistoryList } from "@/components/history/history-list";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/research/state-panel";
import { listThreads } from "@/lib/history";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "History · Comps" };

const buttonClass =
  "mt-3 inline-block rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink";

// Read-only view over the signed-in user's saved research threads (HIST-001..007). Opening it never runs the agent or counts usage.
export default async function HistoryPage() {
  const user = await getCurrentUser();
  const history = user ? await listThreads(user.id) : null;

  return (
    <AppShell section="History" requireUser>
      <div className="mx-auto w-full max-w-(--answer-max) flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">History</h1>
          <p className="mt-2 text-[15px] text-ink-3">Your recent research threads</p>
        </header>

        <div className="mt-8">
          {!history || !history.ok ? (
            <StatePanel tone="error" title="We couldn't load your research history.">
              <Link href="/history" className={buttonClass}>
                Try again
              </Link>
            </StatePanel>
          ) : history.rows.length === 0 ? (
            <StatePanel title="No research yet">
              <p>Your completed Comps research will appear here automatically.</p>
              <Link href="/" className={buttonClass}>
                Start researching
              </Link>
            </StatePanel>
          ) : (
            <HistoryList rows={history.rows} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
