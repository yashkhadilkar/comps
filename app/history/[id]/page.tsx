import type { Metadata } from "next";
import Link from "next/link";
import { AskForm } from "@/components/ask-form";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/research/state-panel";
import { getThread } from "@/lib/history";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Research thread · Comps" };

const linkClass = "text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink";

// One research thread: every saved turn rebuilt from Supabase (nothing depends on client state), plus a composer that
// continues the same thread. Opening it never runs the agent or counts usage; only a new question does (/api/agent).
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const result = user ? await getThread(user.id, id) : ({ state: "error" } as const);

  return (
    <AppShell section="History" requireUser>
      {result.state === "ok" ? (
        <AskForm key={result.thread.id} initialThread={result.thread} />
      ) : (
        <div className="mx-auto w-full max-w-(--answer-max) flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
          <Link href="/history" className={linkClass}>
            &larr; History
          </Link>
          <div className="mt-8">
            {result.state === "missing" ? (
              <StatePanel title="Research not found">
                <p>This research may no longer be available.</p>
              </StatePanel>
            ) : (
              <StatePanel tone="error" title="We couldn't load this research.">
                <p>Please try again in a moment.</p>
              </StatePanel>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
