import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { ConfirmingUpgrade } from "@/components/billing/upgrade-status";
import { AppShell } from "@/components/layout/app-shell";
import { CheckIcon } from "@/components/ui/icons";
import { FREE_QUESTION_LIMIT, PRO_DAILY_LIMIT, PRO_PRICE_USD, type Plan } from "@/lib/plans";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUserPlan } from "@/lib/usage";

export const metadata: Metadata = { title: "Pricing · Comps" };

const secondaryButton =
  "block w-full rounded-md border border-line px-4 py-2 text-center text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink";
const disabledButton =
  "block w-full cursor-not-allowed rounded-md border border-line-subtle bg-subtle px-4 py-2 text-center text-[13px] font-medium text-ink-4";

// Plans from docs/PRD.md. The Pro button starts a Stripe test-mode Checkout; Pro itself is only ever granted by the
// verified webhook, so ?checkout=success just shows a "confirming" state until the plan reads Pro.
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const [user, { checkout }] = await Promise.all([getCurrentUser(), searchParams]);
  let plan: Plan | null = null;
  if (user) {
    try {
      plan = await getUserPlan(user.id);
    } catch (err) {
      console.error("[pricing] plan lookup failed", err instanceof Error ? err.message : err);
    }
  }

  return (
    <AppShell section="Pricing">
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-xl">
          <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Simple research access</h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-3">
            Cited peer benchmarks from SEC filings, without the enterprise price tag.
          </p>
        </header>

        {checkout === "success" && plan === "free" && (
          <div className="mt-8">
            <ConfirmingUpgrade />
          </div>
        )}
        {checkout === "success" && plan === "pro" && (
          <div role="status" className="mt-8 rounded-md border border-line-subtle border-l-2 border-l-accent bg-raised px-5 py-4 text-[14px] text-ink-2">
            Upgrade complete. You&rsquo;re on Pro with {PRO_DAILY_LIMIT} questions a day.
          </div>
        )}
        {checkout === "cancelled" && plan !== "pro" && (
          <div role="status" className="mt-8 rounded-md border border-line-subtle border-l-2 border-l-line-strong bg-raised px-5 py-4 text-[14px] text-ink-2">
            Checkout cancelled. You haven&rsquo;t been charged and your plan is unchanged.
          </div>
        )}

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <PlanCard
            name="Free"
            price="$0"
            blurb="Try it out."
            features={[`${FREE_QUESTION_LIMIT} research questions`, "Cited answers from SEC filings", "Visible research trace"]}
          >
            <Link href={user ? "/" : "/signup"} className={secondaryButton}>
              {user ? "Ask a question" : "Start free"}
            </Link>
          </PlanCard>

          <PlanCard
            name="Pro"
            price={`$${PRO_PRICE_USD}`}
            priceNote="one-time"
            blurb="For regular research."
            features={[`${PRO_DAILY_LIMIT} questions a day`, "Everything in Free"]}
            recommended
          >
            {plan === "pro" ? (
              <p className="flex items-center justify-center gap-2 rounded-md border border-line-subtle bg-subtle px-4 py-2 text-[13px] font-medium text-ink">
                <CheckIcon size={14} className="text-accent" />
                You&rsquo;re on Pro
              </p>
            ) : user && plan === "free" ? (
              <CheckoutButton />
            ) : user ? (
              <p className="text-center text-xs text-ink-4">Couldn&rsquo;t load your plan. Reload to try again.</p>
            ) : (
              <Link href="/signup" className={secondaryButton}>
                Sign up to upgrade
              </Link>
            )}
          </PlanCard>

          <PlanCard
            name="Team"
            price="Contact us"
            blurb="Built for analyst teams."
            features={["Higher limits", "Multiple seats", "Shared workspace"]}
          >
            <button type="button" disabled className={disabledButton}>
              Contact us
            </button>
            <p className="mt-2 text-center text-xs text-ink-4">Team plans aren&rsquo;t available yet.</p>
          </PlanCard>
        </div>
      </div>
    </AppShell>
  );
}

function PlanCard({
  name,
  price,
  priceNote,
  blurb,
  features,
  recommended = false,
  children,
}: {
  name: string;
  price: string;
  priceNote?: string;
  blurb: string;
  features: string[];
  recommended?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`plan-${name}`}
      className={`flex flex-col rounded-lg border bg-raised p-5 ${recommended ? "border-line-strong" : "border-line"}`}
    >
      <div className="flex items-center justify-between">
        <h2 id={`plan-${name}`} className="text-[15px] font-medium text-ink">
          {name}
        </h2>
        {recommended && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-accent">Recommended</span>
        )}
      </div>
      <p className="mt-1 text-[13px] text-ink-3">{blurb}</p>
      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="text-2xl font-medium text-ink">{price}</span>
        {priceNote && <span className="text-[13px] text-ink-3">{priceNote}</span>}
      </p>
      <ul className="mt-5 flex-1 space-y-2.5 text-[13px] text-ink-2">
        {features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <CheckIcon size={14} className="mt-0.5 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">{children}</div>
    </section>
  );
}
