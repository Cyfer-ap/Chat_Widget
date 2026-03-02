"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSupabaseAuth } from "@/lib/useAuth";
import type { Conversation, Message } from "@/lib/types";

const TENANT_STORAGE_KEY = "chat_widget_tenant_id";

function appendMessage(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  message: Message
) {
  setMessages((prev) =>
    prev.some((existing) => existing.id === message.id)
      ? prev
      : [...prev, message]
  );
}

function mergeMessages(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  incoming: Message[]
) {
  setMessages((prev) => {
    const byId = new Map(prev.map((item) => [item.id, item]));
    for (const msg of incoming) byId.set(msg.id, msg);
    return Array.from(byId.values()).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
  });
}

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params?.id as string | undefined;
  const { session, loading } = useSupabaseAuth();
  const [tenantId, setTenantId] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TENANT_STORAGE_KEY);
    if (stored) setTenantId(stored);
  }, []);

  const canLoad = useMemo(
    () => Boolean(session && conversationId),
    [session, conversationId]
  );

  useEffect(() => {
    if (!canLoad) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Missing Supabase environment variables.");
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const loadConversation = async () => {
      setBusy(true);
      setError(null);

      let conversationQuery = supabase
        .from("conversations")
        .select("id, tenant_id, visitor_id, status, created_at")
        .eq("id", conversationId);

      if (tenantId) {
        conversationQuery = conversationQuery.eq("tenant_id", tenantId);
      }

      const { data: conversationData, error: conversationError } =
        await conversationQuery.single();

      if (conversationError) {
        setError(conversationError.message);
        setBusy(false);
        return;
      }

      setConversation(conversationData);

      let messageQuery = supabase
        .from("messages")
        .select("id, tenant_id, conversation_id, sender_type, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (tenantId) {
        messageQuery = messageQuery.eq("tenant_id", tenantId);
      }

      const { data: messageData, error: messageError } = await messageQuery;

      if (messageError) {
        setError(messageError.message);
      } else {
        setMessages(messageData ?? []);
      }

      setBusy(false);

      pollHandle = setInterval(async () => {
        let pollQuery = supabase
          .from("messages")
          .select("id, tenant_id, conversation_id, sender_type, body, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });

        if (tenantId) {
          pollQuery = pollQuery.eq("tenant_id", tenantId);
        }

        const { data: polled } = await pollQuery;
        if (polled?.length) mergeMessages(setMessages, polled);
      }, 5000);

      channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const incoming = payload.new as Message;
            appendMessage(setMessages, incoming);
          }
        )
        .subscribe();
    };

    loadConversation();

    return () => {
      if (pollHandle) clearInterval(pollHandle);
      if (channel) supabase.removeChannel(channel);
    };
  }, [canLoad, conversationId, tenantId]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!conversationId || !body.trim()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Missing Supabase environment variables.");
      return;
    }

    const nextTenantId = tenantId || conversation?.tenant_id;
    if (!nextTenantId) {
      setError("Missing tenant ID for this conversation.");
      return;
    }

    const nextBody = body.trim();
    setBody("");

    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({
        tenant_id: nextTenantId,
        conversation_id: conversationId,
        sender_type: "agent",
        body: nextBody,
      })
      .select("id, tenant_id, conversation_id, sender_type, body, created_at")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (data) appendMessage(setMessages, data);
  };

  const toggleStatus = async () => {
    if (!conversation) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Missing Supabase environment variables.");
      return;
    }

    const nextTenantId = tenantId || conversation.tenant_id;
    if (!nextTenantId) {
      setError("Missing tenant ID for this conversation.");
      return;
    }

    const nextStatus = conversation.status === "open" ? "resolved" : "open";

    const { error: updateError } = await supabase
      .from("conversations")
      .update({ status: nextStatus })
      .eq("id", conversation.id)
      .eq("tenant_id", nextTenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setConversation({ ...conversation, status: nextStatus });
  };

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
            Please sign in to view this conversation.
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
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-zinc-500">
              ← Back to inbox
            </Link>
            <h1 className="text-2xl font-semibold text-zinc-900">
              Conversation {conversationId?.slice(0, 8)}
            </h1>
          </div>
          <button
            type="button"
            onClick={toggleStatus}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            Mark {conversation?.status === "open" ? "resolved" : "open"}
          </button>
        </header>

        {error ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {error}
          </p>
        ) : null}

        <div className="flex-1 rounded-lg border border-zinc-200 bg-white">
          {busy ? (
            <p className="p-4 text-sm text-zinc-500">Loading messages...</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-sm text-zinc-500">No messages yet.</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                      message.sender_type === "agent"
                        ? "ml-auto bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    {message.body}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3"
        >
          <input
            type="text"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type a reply..."
            className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

