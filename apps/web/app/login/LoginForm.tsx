"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { browserSupabase } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const { error } = await browserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setError(error.message);
      setState("idle");
    } else {
      setState("sent");
    }
  }

  async function google() {
    setError(null);
    const { error } = await browserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  }

  if (state === "sent") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-ink bg-paper p-5">
        <p className="font-display text-lg">Check your inbox ✉️</p>
        <p className="mt-1 text-sm text-ink-2">
          We sent a sign-in link to <b>{email}</b>. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <Button variant="ghost" className="w-full" onClick={google} type="button">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-xs font-semibold text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block text-sm font-semibold" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border-2 border-ink bg-white px-3 py-2.5 outline-none focus:shadow-[3px_3px_0_0_var(--color-marker)]"
        />
        <Button type="submit" className="w-full" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
      {error ? <p className="text-sm text-[#9b2c17]">{error}</p> : null}
    </div>
  );
}
