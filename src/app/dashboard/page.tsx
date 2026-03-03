'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useSupabaseAuth } from '@/lib/useAuth';
import type { Conversation, Message } from '@/lib/types';
import ThemeToggle from '@/components/ThemeToggle';

const TENANT_STORAGE_KEY = 'chat_widget_tenant_id';
const DASHBOARD_LAST_READ_KEY = 'chat_dashboard_last_read';

const getLastReadMap = (): Record<string, string> => {
  const raw = localStorage.getItem(DASHBOARD_LAST_READ_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

const setLastReadMap = (next: Record<string, string>) => {
  localStorage.setItem(DASHBOARD_LAST_READ_KEY, JSON.stringify(next));
};

const formatRelativeTime = (value: string) => {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(value).toLocaleDateString();
};

export default function DashboardPage() {
  const { session, loading } = useSupabaseAuth();
  const [tenantId, setTenantId] = useState('');
  const [agentTenants, setAgentTenants] = useState<string[]>([]);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'closed' | 'all'>('open');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestMessages, setLatestMessages] = useState<Record<string, Message>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // On mount, keep the previous tenant if it was one of the agent's tenants
  useEffect(() => {
    const stored = localStorage.getItem(TENANT_STORAGE_KEY);
    if (stored) setTenantId(stored);
  }, []);

  // Persist tenant selection locally (but will be overridden by agent tenancy check)
  useEffect(() => {
    if (tenantId) localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  }, [tenantId]);

  // When session is available, fetch the list of tenants this agent is allowed to view
  useEffect(() => {
    if (!session) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Missing Supabase environment variables.');
      return;
    }

    (async () => {
      try {
        // fetch agent rows for this user
        const { data, error: agentError } = await supabase
          .from('agents')
          .select('tenant_id')
          .eq('user_id', session.user.id);

        if (agentError) {
          setError(agentError.message);
          return;
        }

        const tenantIds = (data ?? []).map((r: any) => r.tenant_id).filter(Boolean);
        const uniqueTenantIds = Array.from(new Set(tenantIds));

        if (uniqueTenantIds.length === 0) {
          // user has no tenant access — avoid showing all tenants
          setError('Your account is not associated with any tenant. Contact an admin to be added.');
          setAgentTenants([]);
          setTenantId('');
          return;
        }

        setAgentTenants(uniqueTenantIds);

        // If localStorage had a tenant that is allowed, keep it; otherwise default to first allowed tenant
        const stored = localStorage.getItem(TENANT_STORAGE_KEY);
        if (stored && uniqueTenantIds.includes(stored)) {
          setTenantId(stored);
        } else {
          setTenantId(uniqueTenantIds[0]);
        }
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    })();
  }, [session]);

  const canLoad = useMemo(() => Boolean(session && tenantId), [session, tenantId]);

  useEffect(() => {
    if (!canLoad) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Missing Supabase environment variables.');
      return;
    }

    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const loadConversations = async (isPoll = false) => {
      if (!hasLoaded && !isPoll) setBusy(true);
      if (isPoll) setIsRefreshing(true);
      setError(null);

      let query = supabase
        .from('conversations')
        .select(
          'id, tenant_id, visitor_id, status, created_at, last_message_at, last_activity_at, subject, resolved_at',
        )
        .order('last_message_at', { ascending: false });

      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data, error: queryError } =
        filter === 'all' ? await query : await query.eq('status', filter);

      if (queryError) {
        setError(queryError.message);
        setBusy(false);
        setIsRefreshing(false);
        return;
      }

      const conversationsData = data ?? [];

      const conversationIds = conversationsData.map((conversation) => conversation.id);
      if (conversationIds.length > 0) {
        const { data: messageData } = await supabase
          .from('messages')
          .select('id, tenant_id, conversation_id, sender_type, body, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false });

        if (messageData) {
          const latestMap: Record<string, Message> = {};
          const unreadMap: Record<string, number> = {};
          const lastReadMap = getLastReadMap();
          const withMessages = new Set<string>();

          for (const message of messageData) {
            withMessages.add(message.conversation_id);
            if (!latestMap[message.conversation_id]) {
              latestMap[message.conversation_id] = message as Message;
            }

            if (message.sender_type === 'visitor') {
              const lastReadAt = lastReadMap[message.conversation_id];
              if (!lastReadAt || message.created_at > lastReadAt) {
                unreadMap[message.conversation_id] = (unreadMap[message.conversation_id] ?? 0) + 1;
              }
            }
          }

          setConversations(
            conversationsData.filter((conversation) => withMessages.has(conversation.id)),
          );
          setLatestMessages(latestMap);
          setUnreadCounts(unreadMap);
        } else {
          setConversations([]);
          setLatestMessages({});
          setUnreadCounts({});
        }
      } else {
        setConversations([]);
        setLatestMessages({});
        setUnreadCounts({});
      }

      setBusy(false);
      setIsRefreshing(false);
      setHasLoaded(true);
    };

    loadConversations();

    pollHandle = setInterval(() => loadConversations(true), 5000);

    return () => {
      if (pollHandle) clearInterval(pollHandle);
    };
  }, [canLoad, filter, tenantId, hasLoaded]);

  useEffect(() => {
    if (!canLoad) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel('dashboard-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const message = payload.new as Message;
          if (tenantId && message.tenant_id !== tenantId) return;

          setLatestMessages((prev) => ({
            ...prev,
            [message.conversation_id]: message,
          }));

          if (message.sender_type === 'visitor') {
            setUnreadCounts((prev) => ({
              ...prev,
              [message.conversation_id]: (prev[message.conversation_id] ?? 0) + 1,
            }));
          }

          setConversations((prev) => {
            if (message.sender_type === 'visitor' && filter === 'resolved') {
              return prev.filter((conversation) => conversation.id !== message.conversation_id);
            }
            if (message.sender_type === 'visitor' && filter === 'closed') {
              return prev.filter((conversation) => conversation.id !== message.conversation_id);
            }

            const idx = prev.findIndex(
              (conversation) => conversation.id === message.conversation_id,
            );
            if (idx === -1) {
              void (async () => {
                const { data: conversationData } = await supabase
                  .from('conversations')
                  .select(
                    'id, tenant_id, visitor_id, status, created_at, last_message_at, last_activity_at, subject, resolved_at',
                  )
                  .eq('id', message.conversation_id)
                  .maybeSingle();

                if (!conversationData) return;
                if (filter !== 'all' && conversationData.status !== filter) {
                  return;
                }

                setConversations((current) => {
                  if (current.some((conversation) => conversation.id === conversationData.id)) {
                    return current;
                  }
                  return [conversationData as Conversation, ...current];
                });
              })();
              return prev;
            }

            // bump to top
            const next = [...prev];
            const [item] = next.splice(idx, 1);
            next.unshift(item);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, [canLoad, filter, tenantId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Checking session...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-zinc-900">Agent access</h1>
          <p className="mt-2 text-sm text-zinc-500">Please sign in to view conversations.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] p-4 sm:p-6 text-[color:var(--foreground)]">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="relative">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Inbox</h1>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                Track and reply to live conversations.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ThemeToggle />
              {/* Tenant selector: show dropdown if the agent has multiple tenants, otherwise read-only input. */}
              {agentTenants.length > 1 ? (
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 sm:w-64"
                  aria-label="Tenant ID"
                >
                  {agentTenants.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Tenant ID"
                  value={tenantId}
                  readOnly
                  className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 sm:w-64"
                  aria-label="Tenant ID"
                />
              )}
              <div
                className="flex w-full flex-wrap gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-1 sm:w-auto sm:flex-nowrap"
                role="group"
                aria-label="Conversation filter"
              >
                <button
                  type="button"
                  onClick={() => setFilter('open')}
                  className={`rounded-md px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                    filter === 'open' ? 'bg-zinc-900 text-white' : 'text-zinc-600'
                  }`}
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('resolved')}
                  className={`rounded-md px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                    filter === 'resolved' ? 'bg-zinc-900 text-white' : 'text-zinc-600'
                  }`}
                >
                  Resolved
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('closed')}
                  className={`rounded-md px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                    filter === 'closed' ? 'bg-zinc-900 text-white' : 'text-zinc-600'
                  }`}
                >
                  Closed
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`rounded-md px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                    filter === 'all' ? 'bg-zinc-900 text-white' : 'text-zinc-600'
                  }`}
                >
                  All
                </button>
              </div>
            </div>
          </header>

          {isRefreshing ? (
            <span className="absolute right-0 top-0 rounded-full bg-[color:var(--muted)] px-2 py-1 text-xs text-[color:var(--muted-foreground)]">
              Refreshing...
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{error}</p>
        ) : null}

        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)]">
          {busy && conversations.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--muted-foreground)]">
              Loading conversations...
            </p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--muted-foreground)]">
              No conversations found for this tenant.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {conversations.map((conversation) => {
                const latestMessage = latestMessages[conversation.id];
                const latestTimestamp =
                  latestMessage?.created_at ??
                  conversation.last_message_at ??
                  conversation.created_at;
                const previewText = latestMessage ? latestMessage.body : 'No messages yet.';
                const unreadCount = unreadCounts[conversation.id] ?? 0;
                return (
                  <li key={conversation.id} className="p-3 sm:p-4">
                    <Link
                      href={`/dashboard/conversations/${conversation.id}`}
                      onClick={() => {
                        const lastReadMap = getLastReadMap();
                        setLastReadMap({
                          ...lastReadMap,
                          [conversation.id]: latestTimestamp,
                        });
                        setUnreadCounts((prev) => ({
                          ...prev,
                          [conversation.id]: 0,
                        }));
                      }}
                      className="group flex flex-col items-start justify-between gap-3 rounded-xl border border-transparent px-2 py-3 transition hover:border-[color:var(--border)] hover:bg-[color:var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--primary)] text-sm font-semibold text-[color:var(--primary-foreground)]">
                          {conversation.id.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">
                              Conversation {conversation.id.slice(0, 8)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                conversation.status === 'resolved'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : conversation.status === 'closed'
                                    ? 'bg-zinc-200 text-zinc-700'
                                    : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {conversation.status}
                            </span>
                            {unreadCount > 0 ? (
                              <span className="rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-xs font-semibold text-[color:var(--accent-foreground)]">
                                {unreadCount}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm text-[color:var(--muted-foreground)]">
                            {previewText}
                          </p>
                        </div>
                      </div>
                      <div className="flex w-full flex-row items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)] sm:w-auto sm:flex-col sm:items-end">
                        <span title={new Date(latestTimestamp).toLocaleString()}>
                          {formatRelativeTime(latestTimestamp)}
                        </span>
                        <span className="h-2 w-2 rounded-full bg-[color:var(--border)] group-hover:bg-[color:var(--muted-foreground)]" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
