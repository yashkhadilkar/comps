"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 2000;
const MAX_POLLS = 15; // ~30 seconds of webhook lag before we stop and say so

// Shown after Stripe redirects back with ?checkout=success while the plan is still Free.
// The redirect proves nothing; this only re-reads the plan the webhook writes (PAY-006).
// Once the webhook lands, the server re-renders the page as Pro and this component unmounts.
export function ConfirmingUpgrade() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls >= MAX_POLLS) {
        clearInterval(id);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div role="status" className="mb-8 rounded-md border border-line-subtle border-l-2 border-l-line-strong bg-raised px-5 py-4">
      <h2 className="text-[15px] font-medium text-ink">
        {timedOut ? "Still confirming your payment" : "Confirming your upgrade…"}
      </h2>
      <p className="mt-1 text-[14px] leading-6 text-ink-2">
        {timedOut
          ? "Stripe hasn't confirmed the payment yet. Your plan updates automatically once it does; reload this page in a minute."
          : "Payment received. Waiting for Stripe to confirm it before unlocking Pro."}
      </p>
      {timedOut && (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink"
        >
          Check again
        </button>
      )}
    </div>
  );
}
