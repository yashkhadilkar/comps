import "server-only";
import Stripe from "stripe";

// Server-only Stripe client (test mode for this capstone), shared by the checkout and webhook routes.
// Created lazily so a missing key fails the request that needs it, not the whole build.
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  // PAY-001: refuse live keys outright.
  if (!key.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...).");
  client = new Stripe(key);
  return client;
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set.");
  return url.replace(/\/+$/, "");
}
