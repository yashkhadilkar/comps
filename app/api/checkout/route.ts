import { NextResponse } from "next/server";
import { createProCheckout } from "@/lib/billing";
import { getAppUrl, getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUserPlan } from "@/lib/usage";

// Starts a one-time $19 Stripe Checkout (test mode). This route never grants Pro:
// only the verified webhook does (PAY-006). The user id comes from the session, never the request body.
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Please log in to upgrade." }, { status: 401 });
    }
    const stripe = getStripe();
    const outcome = await createProCheckout(user, {
      getPlan: getUserPlan,
      createSession: (params) => stripe.checkout.sessions.create(params),
      appUrl: getAppUrl(),
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error("[api/checkout]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Couldn't start checkout. Please try again." }, { status: 500 });
  }
}
