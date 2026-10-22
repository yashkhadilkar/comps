import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listThreads } from "@/lib/history";
import { type Plan } from "@/lib/plans";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { checkUsage } from "@/lib/usage";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

const RECENT_THREADS_LIMIT = 20;

// Sidebar + top bar + content area for the signed-in app and the public pricing page.
export async function AppShell({
  section,
  requireUser = false,
  children,
}: {
  section: string;
  requireUser?: boolean; // proxy.ts already redirects logged-out users; this is the server-side backstop
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user && requireUser) redirect("/login");

  let plan: Plan | null = null;
  let remaining: number | undefined;
  let unlimited = false;
  if (user) {
    try {
      const usage = await checkUsage(user.id);
      plan = usage.plan;
      remaining = usage.unlimited ? undefined : usage.remaining;
      unlimited = usage.unlimited;
    } catch (err) {
      // The badge must never take the page down. Fall back to the plan alone, without a count.
      console.error("[app-shell] usage lookup failed", err instanceof Error ? err.message : err);
      const supabase = await createClient();
      const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();
      plan = profile?.plan === "pro" ? "pro" : "free";
    }
  }

  // Recent research for the sidebar: titles and counts only (no traces or answers). Failure shows an inline message.
  const recent = user ? await listThreads(user.id, RECENT_THREADS_LIMIT) : null;

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <Sidebar userId={user?.id} recent={recent} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar section={section} user={user} plan={plan} remaining={remaining} unlimited={unlimited} />
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
