"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const primaryButton =
  "block w-full rounded-md bg-accent px-4 py-2 text-center text-[13px] font-medium text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

// Starts Stripe Checkout. It only creates a session and redirects; it never changes the plan.
export function CheckoutButton({ label = "Upgrade to Pro" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string; code?: string } | null;
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 409 && data?.code === "ALREADY_PRO") {
        router.refresh(); // the pricing page now renders the Pro state
        return;
      }
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Couldn't start checkout. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url); // stay disabled while the browser leaves
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void start()} disabled={busy} className={primaryButton}>
        {busy ? "Redirecting to checkout…" : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-neg">
          {error}
        </p>
      )}
    </>
  );
}
