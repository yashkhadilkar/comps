"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export function AuthForm({ mode, initialError }: { mode: Mode; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [message, setMessage] = useState<string | null>(null);

  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      });
      if (error) throw error;

      if (data.session) {
        // Email confirmation is off in Supabase, so the user is already logged in.
        router.replace("/");
        router.refresh();
        return;
      }
      setMessage("Check your email for a confirmation link, then log in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1.5 w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 placeholder:text-ink-4 focus:border-line-strong focus:ring-2 focus:ring-accent-soft";

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          aria-label="Comps"
          className="mx-auto mb-6 flex h-10 w-10 items-center justify-center rounded-md border border-line bg-raised text-base font-semibold text-ink"
        >
          C
        </Link>
        <div className="rounded-lg border border-line bg-raised p-6">
          <h1 className="text-lg font-semibold text-ink">{isLogin ? "Log in to Comps" : "Create your account"}</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {isLogin ? "Welcome back." : "Start with 3 free questions."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-ink-2">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-2">Password</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-[13px] text-neg">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] text-accent">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas transition-colors duration-150 hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? "Please wait…" : isLogin ? "Log in" : "Sign up"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[13px] text-ink-3">
          {isLogin ? "New to Comps? " : "Already have an account? "}
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {isLogin ? "Sign up" : "Log in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
