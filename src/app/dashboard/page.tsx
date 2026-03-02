"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSupabaseAuth } from "@/lib/useAuth";
import type { Conversation, Message } from "@/lib/types";

const TENANT_STORAGE_KEY = "chat_widget_tenant_id";

export default function DashboardPage() {
  const { session, loading } = useSupabaseAuth();
  const [tenantId, setTenantId] = useState("");
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TENANT_STORAGE_KEY);
    if (stored) setTenantId(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  }, [tenantId]);

  const canLoad = useMemo(() => Boolean(session), [session]);

  useEffect(() => {
    if (!canLoad) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Missing Supabase environment variables.");
      return;
    }

    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const loadConversations = async () => {
      setBusy(true);
      setError(null);

      let query = supabase
        .from("conversations")
        .select("id, tenant_id, visitor_id, status, created_at, last_message_at")
        .order("last_message_at", { ascending: false });

      if (tenantId) {
        query = query.eq("tenant_id", tenantId);
      }

      const { data, error: queryError } =
        filter === "all" ? await query : await query.eq("status", filter);

      if (queryError) {
        setError(queryError.message);
      } else {
        setConversations(data ?? []);
      }
      setBusy(false);
    };

    loadConversations();

    pollHandle = setInterval(loadConversations, 5000);

    return () => {
      if (pollHandle) clearInterval(pollHandle);
    };
  }, [canLoad, filter, tenantId]);

  useEffect(() => {
    if (!canLoad) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel("dashboard-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as Message;
          if (tenantId && message.tenant_id !== tenantId) return;

          setConversations((prev) => {
            const idx = prev.findIndex(
              (conversation) => conversation.id === message.conversation_id
            );
            if (idx === -1) return prev;

            const updated = {
              ...prev[idx],
              last_message_at: message.created_at,
            };

            const next = prev.slice();
            next.splice(idx, 1);
            next.unshift(updated);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canLoad, tenantId]);

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
          <p className="mt-2 text-sm text-zinc-500">
            Please sign in to view conversations.
          </p>
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
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Inbox</h1>
            <p className="text-sm text-zinc-500">
              Track and reply to live conversations.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Tenant ID"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm sm:w-64"
            />
            <div className="flex rounded-md border border-zinc-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setFilter("open")}
                className={`rounded-md px-3 py-1 text-sm ${
                  filter === "open"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600"
                }`}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setFilter("resolved")}
                className={`rounded-md px-3 py-1 text-sm ${
                  filter === "resolved"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600"
                }`}
              >
                Resolved
              </button>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-md px-3 py-1 text-sm ${
                  filter === "all"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600"
                }`}
              >
                All
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {error}
          </p>
        ) : null}

        <div className="rounded-lg border border-zinc-200 bg-white">
          {busy ? (
            <p className="p-4 text-sm text-zinc-500">Loading conversations...</p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">
              No conversations found for this tenant.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="p-4">
                  <Link
                    href={`/dashboard/conversations/${conversation.id}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-medium text-zinc-900">
                      Conversation {conversation.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(
                        conversation.last_message_at ?? conversation.created_at
                      ).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
