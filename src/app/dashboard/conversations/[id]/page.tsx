"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSupabaseAuth } from "@/lib/useAuth";
import type { Conversation, Message } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

const TENANT_STORAGE_KEY = "chat_widget_tenant_id";
const DASHBOARD_LAST_READ_KEY = "chat_dashboard_last_read";

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

const isSameDay = (left: string, right: string) => {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
};

const formatDayLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  if (isSameDay(value, today.toISOString())) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(value, yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString();
};

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
  const [sending, setSending] = useState(false);
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [didInitialScroll, setDidInitialScroll] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const typingChannelRef = useRef<
    ReturnType<NonNullable<ReturnType<typeof getSupabaseClient>>["channel"]> | null
  >(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

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
        .select(
          "id, tenant_id, visitor_id, status, created_at, last_message_at, subject, resolved_at, last_activity_at"
        )
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
            if (incoming.sender_type === "visitor") {
              setConversation((prev) =>
                prev && prev.status !== "open" && prev.status !== "closed"
                  ? { ...prev, status: "open" }
                  : prev
              );
            }
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

  useEffect(() => {
    if (!conversationId) return;
    const lastReadMap = getLastReadMap();
    setUnreadCutoff(lastReadMap[conversationId] ?? null);
  }, [conversationId]);

  useEffect(() => {
    if (messages.length === 0 || !conversationId) return;
    const latest = messages[messages.length - 1]?.created_at;
    if (!latest) return;

    const lastReadMap = getLastReadMap();
    setLastReadMap({ ...lastReadMap, [conversationId]: latest });
  }, [messages, conversationId]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distanceFromBottom < 40);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!didInitialScroll) {
      container.scrollTop = container.scrollHeight;
      setDidInitialScroll(true);
      return;
    }

    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isAtBottom, didInitialScroll]);

  useEffect(() => {
    if (!canLoad || !conversationId) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on("broadcast", { event: "typing" }, (payload) => {
        const sender = (payload as { payload?: { sender?: string } }).payload
          ?.sender;
        if (sender === "agent") return;

        setRemoteTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setRemoteTyping(false);
        }, 1400);
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [canLoad, conversationId]);

  useEffect(() => {
    if (!body.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 900) return;
    lastTypingSentRef.current = now;

    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { sender: "agent" },
    });
  }, [body]);

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
    setSending(true);

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
      setSending(false);
      return;
    }

    if (data) appendMessage(setMessages, data);
    setSending(false);
  };

  const updateStatus = async (nextStatus: Conversation["status"]) => {
    if (!conversation) return;

    if (conversation.status === "closed" && nextStatus !== "closed") {
      setError("Closed conversations cannot be reopened.");
      return;
    }

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

  const toggleStatus = async () => {
    if (!conversation) return;
    if (conversation.status === "closed") {
      setError("Closed conversations cannot be reopened.");
      return;
    }
    await updateStatus(conversation.status === "open" ? "resolved" : "open");
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
    <div className="min-h-screen bg-[color:var(--background)] p-4 sm:p-6 text-[color:var(--foreground)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-[color:var(--muted-foreground)]">
              ← Back to inbox
            </Link>
            <h1 className="text-2xl font-semibold">
              Conversation {conversationId?.slice(0, 8)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                conversation?.status === "resolved"
                  ? "bg-emerald-100 text-emerald-700"
                  : conversation?.status === "closed"
                    ? "bg-zinc-200 text-zinc-700"
                    : "bg-amber-100 text-amber-700"
              }`}
            >
              {conversation?.status ?? "open"}
            </span>
            <button
              type="button"
              onClick={toggleStatus}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              {conversation?.status === "open" ? "Resolve" : "Reopen"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Close this conversation? This cannot be reopened.")) {
                  void updateStatus("closed");
                }
              }}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Close
            </button>
          </div>
        </header>

        {error ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {error}
          </p>
        ) : null}

        <div className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)]">
          {busy ? (
            <p className="p-4 text-sm text-[color:var(--muted-foreground)]">Loading messages...</p>
          ) : (
            <div
              ref={messagesContainerRef}
              className="relative flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-3 sm:p-4"
            >
              {messages.length === 0 ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">No messages yet.</p>
              ) : (
                messages.map((message, index) => {
                  const previous = index > 0 ? messages[index - 1] : null;
                  const showDaySeparator =
                    !previous ||
                    !isSameDay(previous.created_at, message.created_at);
                  const isSameSender =
                    previous?.sender_type === message.sender_type;
                  const isAgent = message.sender_type === "agent";
                  const shouldShowUnreadDivider =
                    unreadCutoff &&
                    message.sender_type === "visitor" &&
                    message.created_at > unreadCutoff &&
                    (!previous || previous.created_at <= unreadCutoff);

                  return (
                    <div key={message.id}>
                      {showDaySeparator ? (
                        <div className="my-2 flex items-center justify-center">
                          <span className="rounded-full bg-[color:var(--muted)] px-3 py-1 text-xs font-medium text-[color:var(--muted-foreground)]">
                            {formatDayLabel(message.created_at)}
                          </span>
                        </div>
                      ) : null}
                      {shouldShowUnreadDivider ? (
                        <div className="my-2 flex items-center gap-2">
                          <span className="h-px flex-1 bg-[color:var(--border)]" />
                          <span className="text-xs font-medium text-[color:var(--muted-foreground)]">
                            Unread messages
                          </span>
                          <span className="h-px flex-1 bg-[color:var(--border)]" />
                        </div>
                      ) : null}
                      <div
                        className={`flex ${
                          isAgent ? "justify-end" : "justify-start"
                        } ${isSameSender ? "mt-1" : "mt-4"}`}
                      >
                        <div className="max-w-[75%]">
                          <div
                            className={`rounded-2xl px-4 py-2 text-sm shadow-sm ${
                              isAgent
                                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                                : "bg-[color:var(--muted)] text-[color:var(--foreground)]"
                            } ${
                              isSameSender
                                ? isAgent
                                  ? "rounded-tr-md"
                                  : "rounded-tl-md"
                                : ""
                            }`}
                          >
                            {message.body}
                          </div>
                          <div
                            className={`mt-1 text-[11px] text-[color:var(--muted-foreground)] ${
                              isAgent ? "text-right" : "text-left"
                            }`}
                          >
                            {new Date(message.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {!isAtBottom && messages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const container = messagesContainerRef.current;
                    if (container) container.scrollTop = container.scrollHeight;
                  }}
                  className="sticky bottom-2 ml-auto rounded-full bg-[color:var(--accent)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-foreground)] shadow-sm"
                >
                  Scroll to latest
                </button>
              ) : null}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="flex flex-col gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-3 sm:flex-row sm:items-center"
        >
          <div className="flex flex-1 flex-col gap-1">
            <input
              type="text"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Type a reply..."
              className="flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              disabled={sending}
              aria-label="Reply message"
            />
            {remoteTyping ? (
              <span className="text-xs text-[color:var(--muted-foreground)]">
                Visitor is typing...
              </span>
            ) : null}
          </div>
          <button
            type="submit"
            className={`rounded-md px-4 py-2 text-sm font-medium text-[color:var(--primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
              sending || !body.trim()
                ? "cursor-not-allowed bg-zinc-400"
                : "bg-[color:var(--primary)]"
            }`}
            disabled={sending || !body.trim()}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
