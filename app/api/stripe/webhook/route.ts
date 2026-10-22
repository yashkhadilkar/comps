import { NextResponse } from "next/server";
import { handleStripeWebhook, type WebhookStore } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

const store: WebhookStore = {
  async getProfile(userId) {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("plan, pro_since")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(`profile lookup failed: ${error.message}`);
    return data ? { plan: data.plan === "pro" ? "pro" : "free", pro_since: data.pro_since } : null;
  },
  async setPro(userId, proSince) {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .update({ plan: "pro", pro_since: proSince })
      .eq("id", userId)
      .select("id");
    if (error) throw new Error(`profile update failed: ${error.message}`);
    return (data?.length ?? 0) === 1;
  },
};

// Stripe -> app. The signature is verified against the RAW body before anything else happens (SEC-003).
// Only a verified, paid checkout.session.completed turns a profile into Pro (PAY-006); replays are harmless (PAY-007).
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 500 });
  }
  try {
    const rawBody = await request.text();
    const stripe = getStripe();
    const outcome = await handleStripeWebhook(rawBody, request.headers.get("stripe-signature"), {
      constructEvent: (body, signature) => stripe.webhooks.constructEvent(body, signature, secret),
      store,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error("[stripe/webhook]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }
}
