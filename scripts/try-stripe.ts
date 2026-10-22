// Offline (no network, no database): checkout + webhook logic with REAL Stripe signature verification
// and an in-memory profiles store. Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-stripe.ts
process.env.STRIPE_SECRET_KEY = "sk_test_offline_placeholder";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_offline_test_secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

import Stripe from "stripe";
import { createProCheckout, handleStripeWebhook, type ProfileRow, type WebhookStore } from "../lib/billing";
import type { Plan } from "../lib/plans";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
}

function memStore(initial: Record<string, ProfileRow>) {
  const profiles = { ...initial };
  const writes: string[] = [];
  const store: WebhookStore = {
    getProfile: async (id) => profiles[id] ?? null,
    setPro: async (id, since) => {
      if (!profiles[id]) return false;
      writes.push(id);
      profiles[id] = { plan: "pro", pro_since: since };
      return true;
    },
  };
  return { profiles, writes, store };
}

function sessionEvent(overrides: Partial<Stripe.Checkout.Session> = {}, type = "checkout.session.completed", id = "evt_1") {
  const session = {
    id: "cs_test_1",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: 1900,
    currency: "usd",
    client_reference_id: USER,
    metadata: { supabase_user_id: USER, product: "comps_pro" },
    ...overrides,
  };
  return JSON.stringify({ id, object: "event", type, data: { object: session } });
}

const sign = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
const deps = (store: WebhookStore, now = () => new Date("2026-10-19T10:00:00Z")) => ({
  constructEvent: (body: string, sig: string) => stripe.webhooks.constructEvent(body, sig, SECRET),
  store,
  now,
});
const quiet = async <T,>(fn: () => Promise<T>) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

async function main() {
  // ---- checkout ----
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const checkoutDeps = (plan: Plan) => ({
    getPlan: async () => plan,
    createSession: async (p: Stripe.Checkout.SessionCreateParams) => { created.push(p); return { url: "https://checkout.stripe.com/c/pay/cs_test_1" }; },
    appUrl: "http://localhost:3000",
  });

  let out = await createProCheckout({ id: USER, email: "a@b.co" }, checkoutDeps("free"));
  const p = created[0];
  check("S02 free user gets a checkout URL", out.status === 200 && "url" in out.body, out);
  check("S02 $19 one-time payment in USD", p?.mode === "payment" && p.line_items?.[0]?.price_data?.unit_amount === 1900 && p.line_items?.[0]?.price_data?.currency === "usd", p);
  check("S02 metadata carries the server-known user id", p?.metadata?.supabase_user_id === USER && p?.metadata?.product === "comps_pro" && p?.client_reference_id === USER, p?.metadata);
  check("redirect URLs from NEXT_PUBLIC_APP_URL", p?.success_url === "http://localhost:3000/pricing?checkout=success" && p?.cancel_url === "http://localhost:3000/pricing?checkout=cancelled", [p?.success_url, p?.cancel_url]);

  created.length = 0;
  out = await createProCheckout({ id: USER, email: null }, checkoutDeps("pro"));
  check("S03 already-Pro: 409 ALREADY_PRO, no session created", out.status === 409 && created.length === 0, { out, n: created.length });

  // ---- webhook ----
  const payload = sessionEvent();
  let m = memStore({ [USER]: { plan: "free", pro_since: null }, [OTHER]: { plan: "free", pro_since: null } });

  let r = await handleStripeWebhook(payload, "t=1,v1=deadbeef", deps(m.store));
  check("S04 invalid signature → 400, no write", r.status === 400 && m.writes.length === 0 && m.profiles[USER].plan === "free", r);
  r = await handleStripeWebhook(payload, null, deps(m.store));
  check("S04 missing signature → 400, no write", r.status === 400 && m.writes.length === 0, r);
  r = await handleStripeWebhook(payload + " ", sign(payload), deps(m.store));
  check("S04 tampered body (signed for different payload) → 400, no write", r.status === 400 && m.writes.length === 0, r);
  r = await handleStripeWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }), deps(m.store));
  check("S04 signed with the wrong secret → 400, no write", r.status === 400 && m.writes.length === 0, r);

  r = await handleStripeWebhook(payload, sign(payload), deps(m.store));
  check("S05 valid completed event → user is Pro with pro_since", r.status === 200 && m.profiles[USER].plan === "pro" && m.profiles[USER].pro_since === "2026-10-19T10:00:00.000Z", { r, p: m.profiles[USER] });
  check("S05 other user untouched", m.profiles[OTHER].plan === "free");

  const firstSince = m.profiles[USER].pro_since;
  r = await handleStripeWebhook(payload, sign(payload), deps(m.store, () => new Date("2026-12-01T00:00:00Z")));
  check("S06 replay: still Pro, pro_since unchanged, no second write", r.status === 200 && m.profiles[USER].plan === "pro" && m.profiles[USER].pro_since === firstSince && m.writes.length === 1, { r, writes: m.writes.length });

  // Pro already but pro_since null (e.g. set by hand): fills pro_since without changing plan.
  const m2 = memStore({ [USER]: { plan: "pro", pro_since: null } });
  await handleStripeWebhook(payload, sign(payload), deps(m2.store));
  check("pro with null pro_since gets it filled once", m2.profiles[USER].pro_since === "2026-10-19T10:00:00.000Z");

  // unrelated / non-completing events
  m = memStore({ [USER]: { plan: "free", pro_since: null } });
  for (const type of ["payment_intent.succeeded", "checkout.session.expired", "charge.refunded"]) {
    const body = sessionEvent({}, type);
    r = await handleStripeWebhook(body, sign(body), deps(m.store));
    check(`unrelated event ${type} → 200 no-op`, r.status === 200 && m.writes.length === 0, r);
  }

  // bad sessions: signed and valid, but must not update anything
  const bad: Record<string, Partial<Stripe.Checkout.Session>> = {
    "missing metadata": { metadata: {}, client_reference_id: null },
    "non-uuid user id": { metadata: { supabase_user_id: "' or 1=1 --", product: "comps_pro" }, client_reference_id: null },
    "wrong product": { metadata: { supabase_user_id: USER, product: "other" } },
    "client_reference_id mismatch": { client_reference_id: OTHER },
    unpaid: { payment_status: "unpaid" },
    "wrong amount": { amount_total: 100 },
    "subscription mode": { mode: "subscription" },
  };
  for (const [name, o] of Object.entries(bad)) {
    const body = sessionEvent(o);
    r = await quiet(() => handleStripeWebhook(body, sign(body), deps(m.store)));
    check(`malformed: ${name} → acknowledged, no update`, r.status === 200 && m.writes.length === 0 && m.profiles[USER].plan === "free", r);
  }

  // unknown user id: valid shape, no profile
  const ghost = "aaaaaaaa-2222-4333-8444-555555555555";
  const gb = sessionEvent({ metadata: { supabase_user_id: ghost, product: "comps_pro" }, client_reference_id: ghost });
  r = await quiet(() => handleStripeWebhook(gb, sign(gb), deps(m.store)));
  check("unknown user → no write", r.status === 200 && m.writes.length === 0, r);

  // DB failure surfaces (route turns it into 500 so Stripe retries)
  const failing: WebhookStore = { getProfile: async () => { throw new Error("db down"); }, setPro: async () => true };
  let threw = false;
  try { await handleStripeWebhook(payload, sign(payload), deps(failing)); } catch { threw = true; }
  check("DB error propagates for retry", threw);

  // async payment path also upgrades
  m = memStore({ [USER]: { plan: "free", pro_since: null } });
  const ab = sessionEvent({}, "checkout.session.async_payment_succeeded", "evt_2");
  await handleStripeWebhook(ab, sign(ab), deps(m.store));
  check("async_payment_succeeded upgrades", m.profiles[USER].plan === "pro");

  // ---- the real route handler, invalid signature (no DB env needed because nothing is touched) ----
  const { POST } = await import("../app/api/stripe/webhook/route");
  const res = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: payload }));
  check("route: invalid signature → 400", res.status === 400, res.status);
  const res2 = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload }));
  check("route: no signature header → 400", res2.status === 400, res2.status);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
void main();
