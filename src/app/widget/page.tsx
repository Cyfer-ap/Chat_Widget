"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Message } from "@/lib/types";

const ANON_STORAGE_KEY = "chat_widget_anon_id";
const RATE_LIMIT_KEY = "chat_widget_rate_limit";

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

function canSendMessage() {
  const now = Date.now();
  const raw = localStorage.getItem(RATE_LIMIT_KEY);
  const windowMs = 60_000;
  const maxCount = 8;

  const record = raw ? (JSON.parse(raw) as { start: number; count: number }) : null;
  if (!record || now - record.start > windowMs) {
    localStorage.setItem(
      RATE_LIMIT_KEY,
      JSON.stringify({ start: now, count: 1 })
    );
    return true;
  }

  if (record.count >= maxCount) return false;

  localStorage.setItem(
    RATE_LIMIT_KEY,
    JSON.stringify({ start: record.start, count: record.count + 1 })
  );
  return true;
}

export default function WidgetPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant") ?? "";
  const [authorized, setAuthorized] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Checking domain...");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);

  const supabase = useMemo(() => getSupabaseClient(), []);

  useEffect(() => {
    const verifyDomain = async () => {
      try {
        const referrer = document.referrer;
        const response = await fetch(
          `/api/tenant/authorize?tenant=${encodeURIComponent(
            tenantId
          )}&referrer=${encodeURIComponent(referrer)}`
        );
        const data = (await response.json()) as {
          authorized: boolean;
          message?: string;
        };
        if (data.authorized) {
          setAuthorized(true);
          setStatusMessage("");
        } else {
          setAuthorized(false);
          setStatusMessage(data.message ?? "Unauthorized domain.");
        }
      } catch {
        setAuthorized(false);
        setStatusMessage("Unable to verify domain.");
      }
    };

    if (!tenantId) {
      setAuthorized(false);
      setStatusMessage("Missing tenant ID.");
      return;
    }

    verifyDomain();
  }, [tenantId]);

  useEffect(() => {
    if (!authorized || !tenantId || !supabase) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const initConversation = async () => {
      const { userId, error: anonError } = await ensureAnonId(supabase);
      if (!userId || anonError) {
        setStatusMessage(anonError ?? "Unable to start anonymous session.");
        return;
      }

      const anonId = userId;

      const { data: visitor } = await supabase
        .from("visitors")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("anon_id", anonId)
        .maybeSingle();

      let visitorId = visitor?.id as string | undefined;

      if (!visitorId) {
        const { data: insertedVisitor, error: visitorError } = await supabase
          .from("visitors")
          .insert({ tenant_id: tenantId, anon_id: anonId })
          .select("id")
          .single();

        if (visitorError) {
          setStatusMessage(visitorError.message);
          return;
        }

        visitorId = insertedVisitor.id;
      }

      const { data: existingConversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("visitor_id", visitorId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .maybeSingle();

      let activeConversationId = existingConversation?.id as string | undefined;

      if (!activeConversationId) {
        const { data: insertedConversation, error: conversationError } =
          await supabase
            .from("conversations")
            .insert({
              tenant_id: tenantId,
              visitor_id: visitorId,
              status: "open",
            })
            .select("id")
            .single();

        if (conversationError) {
          setStatusMessage(conversationError.message);
          return;
        }

        activeConversationId = insertedConversation.id;
      }

      setConversationId(activeConversationId);

      const { data: messageData, error: messageError } = await supabase
        .from("messages")
        .select("id, tenant_id, conversation_id, sender_type, body, created_at")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: true });

      if (messageError) {
        setStatusMessage(messageError.message);
        return;
      }

      setMessages(messageData ?? []);

      const poll = setInterval(async () => {
        const { data: polled } = await supabase
          .from("messages")
          .select("id, tenant_id, conversation_id, sender_type, body, created_at")
          .eq("conversation_id", activeConversationId)
          .order("created_at", { ascending: true });
        if (polled?.length) mergeMessages(setMessages, polled);
      }, 5000);

      channel = supabase
        .channel(`messages:${activeConversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${activeConversationId}`,
          },
          (payload) => {
            const incoming = payload.new as Message;
            appendMessage(setMessages, incoming);
          }
        )
        .subscribe();

      return () => {
        clearInterval(poll);
      };
    };

    const cleanupPromise = initConversation();

    return () => {
      if (channel) supabase.removeChannel(channel);
      cleanupPromise?.then((cleanup) => cleanup?.());
    };
  }, [authorized, supabase, tenantId]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!conversationId || !body.trim()) return;

    if (!canSendMessage()) {
      setStatusMessage("Please wait a minute before sending more messages.");
      return;
    }

    if (!supabase) {
      setStatusMessage("Missing Supabase environment variables.");
      return;
    }

    const nextBody = body.trim();
    setBody("");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        sender_type: "visitor",
        body: nextBody,
      })
      .select("id, tenant_id, conversation_id, sender_type, body, created_at")
      .single();

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    if (data) appendMessage(setMessages, data);
  };

  if (!authorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 p-4 text-sm text-zinc-600">
        {statusMessage}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-transparent">
      <div className="fixed bottom-4 right-4 flex flex-col items-end gap-2">
        {open ? (
          <div className="flex h-[480px] w-[320px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between bg-zinc-900 px-4 py-3 text-white">
              <span className="text-sm font-semibold">Live support</span>
              <button
                type="button"
                className="text-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {statusMessage ? (
              <div className="border-b border-zinc-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                {statusMessage}
              </div>
            ) : null}
            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              {messages.length === 0 ? (
                <p className="text-zinc-500">Start the conversation below.</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                      message.sender_type === "visitor"
                        ? "ml-auto bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    {message.body}
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-zinc-200 bg-white p-3"
            >
              <input
                type="text"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Type your message..."
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
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white shadow-lg"
          aria-label="Open chat"
        >
          {open ? "×" : "Chat"}
        </button>
      </div>
    </div>
  );
}

async function ensureAnonId(supabase: ReturnType<typeof getSupabaseClient>) {
  if (!supabase) return { userId: null, error: "Missing Supabase client." };

  const cached = localStorage.getItem(ANON_STORAGE_KEY);
  if (cached) return { userId: cached, error: null };

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) return { userId: null, error: sessionError.message };

  if (!sessionData.session) {
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) return { userId: null, error: signInError.message };
  }

  const { data: refreshed, error: refreshError } =
    await supabase.auth.getSession();
  if (refreshError) return { userId: null, error: refreshError.message };

  const userId = refreshed.session?.user?.id ?? null;
  if (userId) localStorage.setItem(ANON_STORAGE_KEY, userId);
  return { userId, error: null };
}
