import "server-only";
import type Stripe from "stripe";
import { PRO_PRICE_USD, type Plan } from "./plans";

// Checkout and webhook logic (SPEC PAY-002 to PAY-008, SEC-003), kept apart from the route files
// so it can be tested with a fake store and real signature verification, without network or database.

export const PRODUCT_ID = "comps_pro";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Checkout -------------------------------------------------------------------------------

export type CheckoutDeps = {
  getPlan(userId: string): Promise<Plan>;
  createSession(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
  appUrl: string;
};

export type CheckoutOutcome =
  | { status: 200; body: { url: string } }
  | { status: 409; body: { error: string; code: "ALREADY_PRO" } }
  | { status: 502; body: { error: string } };

export async function createProCheckout(
  user: { id: string; email: string | null },
  deps: CheckoutDeps,
): Promise<CheckoutOutcome> {
  // The plan comes from the database, never from the request.
  if ((await deps.getPlan(user.id)) === "pro") {
    return { status: 409, body: { error: "You're already on Pro.", code: "ALREADY_PRO" } };
  }
  const session = await deps.createSession({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRO_PRICE_USD * 100,
          product_data: { name: "Comps Pro", description: "One-time upgrade: 25 research questions per day." },
        },
      },
    ],
    // The authenticated Supabase user id, set by the server. The webhook trusts only this.
    metadata: { supabase_user_id: user.id, product: PRODUCT_ID },
    client_reference_id: user.id,
    ...(user.email ? { customer_email: user.email } : {}),
    success_url: `${deps.appUrl}/pricing?checkout=success`,
    cancel_url: `${deps.appUrl}/pricing?checkout=cancelled`,
  });
  if (!session.url) {
    return { status: 502, body: { error: "Couldn't start checkout. Please try again." } };
  }
  return { status: 200, body: { url: session.url } };
}

// ---- Webhook --------------------------------------------------------------------------------

export type ProfileRow = { plan: Plan; pro_since: string | null };

export type WebhookStore = {
  getProfile(userId: string): Promise<ProfileRow | null>;
  // Returns true when exactly one profile row was updated.
  setPro(userId: string, proSince: string): Promise<boolean>;
};

export type WebhookDeps = {
  constructEvent(rawBody: string, signature: string): Stripe.Event; // throws on a bad signature
  store: WebhookStore;
  now?: () => Date;
};

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

const COMPLETION_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  if (!signature) return { status: 400, body: { error: "Missing Stripe signature." } };

  let event: Stripe.Event;
  try {
    event = deps.constructEvent(rawBody, signature);
  } catch {
    // Nothing has touched the database at this point (SEC-003).
    return { status: 400, body: { error: "Invalid Stripe signature." } };
  }

  if (!COMPLETION_EVENTS.has(event.type)) return { status: 200, body: { received: true, ignored: event.type } };

  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.supabase_user_id;
  const problem = !userId || !UUID.test(userId)
    ? "missing or malformed supabase_user_id metadata"
    : session.metadata?.product !== PRODUCT_ID
      ? "metadata product is not comps_pro"
      : session.client_reference_id && session.client_reference_id !== userId
        ? "client_reference_id does not match metadata"
        : session.mode !== "payment"
          ? "session is not a payment"
          : session.payment_status !== "paid"
            ? "session is not paid"
            : session.currency !== "usd" || session.amount_total !== PRO_PRICE_USD * 100
              ? "amount or currency is not the Pro price"
              : null;
  if (problem || !userId) {
    // Retrying cannot fix a bad event, so acknowledge it, loudly, and change nothing.
    console.error(`[stripe/webhook] ignoring event ${event.id}: ${problem}`);
    return { status: 200, body: { received: true, ignored: "invalid_session" } };
  }

  // A DB error throws; the route answers 500 and Stripe retries.
  const profile = await deps.store.getProfile(userId);
  if (!profile) {
    console.error(`[stripe/webhook] event ${event.id}: no profile for user ${userId}; plan not changed`);
    return { status: 200, body: { received: true, ignored: "no_profile" } };
  }
  if (profile.plan === "pro" && profile.pro_since) {
    return { status: 200, body: { received: true, upgraded: false, reason: "already_pro" } };
  }
  const proSince = profile.pro_since ?? (deps.now?.() ?? new Date()).toISOString();
  if (!(await deps.store.setPro(userId, proSince))) {
    throw new Error(`profile update for event ${event.id} affected no row`);
  }
  return { status: 200, body: { received: true, upgraded: true } };
}
