'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useSupabaseAuth } from '@/lib/useAuth';

const INVITE_TOKEN_STORAGE_KEY = 'chat_widget_invite_token';

function LoginContent() {
  const searchParams = useSearchParams();
  const { session } = useSupabaseAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inviteToken = searchParams.get('token') ?? '';

  const redeemInvite = async (accessToken: string, token: string) => {
    const response = await fetch('/api/agents/accept-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? 'Unable to redeem invite.');
    }
  };

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage('Missing Supabase environment variables.');
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      const tokenToRedeem = inviteToken || localStorage.getItem(INVITE_TOKEN_STORAGE_KEY) || '';
      if (tokenToRedeem && data.session?.access_token) {
        await redeemInvite(data.session.access_token, tokenToRedeem);
        localStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Sign-in failed.';
      setMessage(messageText);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <form
        onSubmit={handleSignIn}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Agent login</h1>
          <p className="text-sm text-zinc-500">Sign in with a Supabase Auth user.</p>
          {inviteToken ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Invite detected. Sign in to accept it.
            </p>
          ) : null}
        </div>
        <label className="block text-sm font-medium text-zinc-700">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </label>
        {message ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{message}</p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        {session?.user?.email ? (
          <p className="text-xs text-zinc-500">
            Signed in as {session.user.email}. If you were invited, your access will be applied
            after signing in again.
          </p>
        ) : null}
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-sm text-zinc-500">
          Loading login...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
