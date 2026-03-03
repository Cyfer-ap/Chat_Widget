"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSupabaseAuth } from "@/lib/useAuth";

const INVITE_TOKEN_STORAGE_KEY = "chat_widget_invite_token";

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading } = useSupabaseAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const tokenParam = searchParams.get("token") ?? "";
    const stored = localStorage.getItem(INVITE_TOKEN_STORAGE_KEY) ?? "";
    const resolved = tokenParam || stored;
    if (resolved) {
      setToken(resolved);
      localStorage.setItem(INVITE_TOKEN_STORAGE_KEY, resolved);
    }
  }, [searchParams]);

  const handleRedeem = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    if (!token.trim()) {
      setMessage("Enter an invite token.");
      setSubmitting(false);
      return;
    }

    if (!session?.access_token) {
      setMessage("Please sign in before redeeming an invite.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/agents/accept-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token: token.trim() }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to redeem invite.");
        setSubmitting(false);
        return;
      }

      localStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
      router.push("/dashboard");
    } catch {
      setMessage("Network error while redeeming invite.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignIn = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage("Missing Supabase environment variables.");
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.href,
      },
    });

    if (error) setMessage(error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900">
            Accept agent invite
          </h1>
          <p className="text-sm text-zinc-500">
            Enter your invite token or open the invite link to join a team.
          </p>
        </div>

        <form onSubmit={handleRedeem} className="space-y-3">
          <label className="block text-sm font-medium text-zinc-700">
            Invite token
            <input
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="Paste invite token"
              required
            />
          </label>

          {message ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading || submitting}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {submitting ? "Redeeming..." : "Redeem invite"}
          </button>
        </form>

        <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-sm text-zinc-500">
          {session ? (
            <p>
              Signed in as{" "}
              <span className="font-semibold">{session.user.email}</span>.
            </p>
          ) : (
            <div className="space-y-2">
              <p>Sign in to redeem your invite.</p>
              <button
                type="button"
                onClick={handleSignIn}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Continue with Google
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-sm text-zinc-500">
          Loading invite...
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
