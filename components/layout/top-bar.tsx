import Link from "next/link";
import { PlanBadge } from "@/components/billing/plan-badge";
import type { Plan } from "@/lib/plans";
import { MobileNav } from "./sidebar";
import { UserMenu } from "./user-menu";

export function TopBar({
  section,
  user,
  plan,
  remaining,
  unlimited,
}: {
  section: string;
  user: { email: string | null } | null;
  plan: Plan | null;
  remaining?: number;
  unlimited?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-(--topbar-height) shrink-0 items-center justify-between gap-3 border-b border-line-subtle bg-canvas/95 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav />
        <p className="truncate text-[13px] text-ink-3">
          <span className="hidden text-ink-2 sm:inline">Comps</span>
          <span className="mx-2 hidden text-ink-4 sm:inline">/</span>
          <span className="text-ink-2 sm:text-ink-3">{section}</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        {user ? (
          <>
            {plan && <PlanBadge plan={plan} remaining={remaining} unlimited={unlimited} />}
            <UserMenu email={user.email} />
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
