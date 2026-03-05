'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { Conversation, Message } from '@/lib/types';
import ThemeToggle from '@/components/ThemeToggle';

const ANON_STORAGE_KEY = 'chat_widget_anon_id';
const WIDGET_LAST_READ_KEY = 'chat_widget_last_read_at';
const NEW_TICKET_AFTER_DAYS = 14;
const REOPEN_WINDOW_DAYS = 7;
const CONVERSATION_SELECT =
  'id, tenant_id, visitor_id, status, created_at, last_message_at, last_activity_at, subject, resolved_at';
const getLastReadKey = (conversationId: string) => `${WIDGET_LAST_READ_KEY}:${conversationId}`;

const daysSince = (value?: string | null) => {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  return Math.floor(diffMs / 86_400_000);
};

const shouldStartNewConversation = (conversation: Conversation | null) => {
  if (!conversation) return true;
  if (conversation.status === 'open' || conversation.status === 'pending') {
    return false;
  }
  if (conversation.status === 'closed') return true;

  if (conversation.status === 'resolved') {
    const resolvedDays = daysSince(
      conversation.resolved_at ?? conversation.last_activity_at ?? conversation.created_at,
    );
    if (resolvedDays === null) return true;
    if (resolvedDays <= REOPEN_WINDOW_DAYS) return false;
    return resolvedDays > NEW_TICKET_AFTER_DAYS;
  }

  return true;
};

function appendMessage(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  message: Message,
) {
  setMessages((prev) =>
    prev.some((existing) => existing.id === message.id) ? prev : [...prev, message],
  );
}

function WidgetContent() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get('tenant') ?? '';
  const initialToken = searchParams.get('token') ?? '';
  const [widgetToken, setWidgetToken] = useState(initialToken);
  const [authorized, setAuthorized] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Checking domain...');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [previousConversations, setPreviousConversations] = useState<Conversation[]>([]);
  const [viewingConversationId, setViewingConversationId] = useState<string | null>(null);
  const [viewingMessages, setViewingMessages] = useState<Message[]>([]);
  const [showPreviousList, setShowPreviousList] = useState(false);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [didInitialScroll, setDidInitialScroll] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const typingChannelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof getSupabaseClient>>['channel']
  > | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  const isViewingPrevious = Boolean(viewingConversationId);
  const displayedMessages = isViewingPrevious ? viewingMessages : messages;

  const supabase = useMemo(() => getSupabaseClient(), []);
  const conversationSelect = CONVERSATION_SELECT;

  /**
   * âœ… NEW: lock token refresh postMessage to the actual parent origin.
   * We derive parent origin from document.referrer (embedding page URL).
   * If referrer is empty (strict Referrer-Policy), token refresh via postMessage wonâ€™t work,
   * but the initial token still works until expiry.
   */
  const expectedParentOrigin = useMemo(() => {
    try {
      if (!document.referrer) return null;
      return new URL(document.referrer).origin;
    } catch {
      return null;
    }
  }, []);

  const createConversation = useCallback(
    async (nextVisitorId: string, subject: string = 'Support request') => {
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('conversations')
        .insert({
          tenant_id: tenantId,
          visitor_id: nextVisitorId,
          status: 'open',
          subject,
        })
        .select(conversationSelect)
        .single();

      if (error) {
        setStatusMessage(error.message);
        return null;
      }

      return data as Conversation;
    },
    [supabase, tenantId, conversationSelect],
  );

  useEffect(() => {
    // Ensure the iframe document stays transparent; only the widget panel
    // should be visible when open.
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.backgroundImage = 'none';
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // âœ… Reject token updates if we can't confidently identify the parent origin
      if (!expectedParentOrigin) return;

      // âœ… Only accept messages from the embedding parent origin
      if (event.origin !== expectedParentOrigin) return;

      // âœ… Only accept messages that actually come from the parent window
      if (event.source !== window.parent) return;

      const data = event.data as unknown;
      if (!data || typeof data !== 'object') return;

      const payload = data as { type?: string; tenant?: string; token?: string };
      if (payload.type !== 'widget-token') return;
      if (payload.tenant && payload.tenant !== tenantId) return;
      if (typeof payload.token !== 'string' || !payload.token) return;

      setWidgetToken(payload.token);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tenantId, expectedParentOrigin]);

  useEffect(() => {
    const verifyToken = async () => {
      if (!tenantId) {
        setAuthorized(false);
        setStatusMessage('Missing tenant ID.');
        return;
      }

      if (!widgetToken) {
        setAuthorized(false);
        setStatusMessage('Missing authorization token.');
        return;
      }

      try {
        const response = await fetch(
          `/api/tenant/verify-token?tenant=${encodeURIComponent(
            tenantId,
          )}&token=${encodeURIComponent(widgetToken)}`,
        );
        const data = (await response.json()) as {
          valid: boolean;
          message?: string;
        };
        if (data.valid) {
          setAuthorized(true);
          setStatusMessage('');
        } else {
          setAuthorized(false);
          setStatusMessage(data.message ?? 'Unauthorized.');
        }
      } catch {
        setAuthorized(false);
        setStatusMessage('Unable to verify authorization.');
      }
    };

    verifyToken();
  }, [tenantId, widgetToken]);

  useEffect(() => {
    if (!authorized || !tenantId || !supabase) return;

    let cancelled = false;

    const initConversation = async () => {
      setInitializing(true);
      const { userId, error: anonError } = await ensureAnonId(supabase);
      if (!userId || anonError) {
        setStatusMessage(anonError ?? 'Unable to start anonymous session.');
        setInitializing(false);
        return;
      }

      const anonId = userId;

      const { data: visitor } = await supabase
        .from('visitors')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('anon_id', anonId)
        .maybeSingle();

      let nextVisitorId: string | null = visitor?.id ?? null;

      if (!nextVisitorId) {
        const { data: insertedVisitor, error: visitorError } = await supabase
          .from('visitors')
          .insert({ tenant_id: tenantId, anon_id: anonId })
          .select('id')
          .single();

        if (visitorError) {
          setStatusMessage(visitorError.message);
          setInitializing(false);
          return;
        }

        nextVisitorId = insertedVisitor?.id ?? null;
      }

      if (!nextVisitorId) {
        setStatusMessage('Unable to resolve visitor session.');
        setInitializing(false);
        return;
      }

      setVisitorId(nextVisitorId);

      const { data: conversationsData, error: conversationError } = await supabase
        .from('conversations')
        .select(conversationSelect)
        .eq('tenant_id', tenantId)
        .eq('visitor_id', nextVisitorId)
        .order('last_activity_at', { ascending: false });

      if (conversationError) {
        setStatusMessage(conversationError.message);
        setInitializing(false);
        return;
      }

      const allConversations = conversationsData ?? [];
      const openConversations = allConversations
        .filter(
          (conversation) => conversation.status === 'open' || conversation.status === 'pending',
        )
        .sort((left, right) =>
          (right.last_activity_at ?? right.created_at).localeCompare(
            left.last_activity_at ?? left.created_at,
          ),
        );

      let nextActive: Conversation | null = openConversations[0] ?? allConversations[0] ?? null;
      if (!openConversations.length && shouldStartNewConversation(nextActive)) {
        nextActive = await createConversation(nextVisitorId);
      }

      if (cancelled || !nextActive) {
        setInitializing(false);
        return;
      }

      setActiveConversation(nextActive);
      setConversationId(nextActive.id);
      setPreviousConversations(allConversations.filter((conv) => conv.id !== nextActive?.id));
      setViewingConversationId(null);
      setViewingMessages([]);
      setMessages([]);
      setUnreadCount(0);
      setUnreadCutoff(null);
      setInitializing(false);
    };

    initConversation();

    return () => {
      cancelled = true;
    };
  }, [authorized, supabase, tenantId, conversationSelect, createConversation]);

  useEffect(() => {
    if (!authorized || !tenantId || !supabase || !conversationId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let typingChannel: ReturnType<typeof supabase.channel> | null = null;

    const loadMessages = async () => {
      const { data: messageData, error: messageError } = await supabase
        .from('messages')
        .select('id, tenant_id, conversation_id, sender_type, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (messageError) {
        setStatusMessage(messageError.message);
        return;
      }

      setMessages(messageData ?? []);

      const lastReadAt = localStorage.getItem(getLastReadKey(conversationId));
      if (lastReadAt) {
        const unread = (messageData ?? []).filter(
          (message) => message.sender_type === 'agent' && message.created_at > lastReadAt,
        ).length;
        setUnreadCount(unread);
      }
    };

    loadMessages();

    pollHandle = setInterval(loadMessages, 5000);

    channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          appendMessage(setMessages, incoming);

          setActiveConversation((prev) => {
            if (!prev || prev.id !== conversationId) return prev;
            const nextStatus =
              incoming.sender_type === 'visitor' && prev.status === 'resolved'
                ? 'open'
                : prev.status;
            return {
              ...prev,
              status: nextStatus,
              last_activity_at: incoming.created_at,
              last_message_at: incoming.created_at,
            };
          });

          if (incoming.sender_type === 'agent' && !open) {
            setUnreadCount((prev) => prev + 1);
          }
        },
      )
      .subscribe();

    typingChannel = supabase
      .channel(`typing:${conversationId}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        const sender = (payload as { payload?: { sender?: string } }).payload?.sender;
        if (sender === 'visitor') return;

        setRemoteTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setRemoteTyping(false);
        }, 1400);
      })
      .subscribe();

    typingChannelRef.current = typingChannel;

    return () => {
      if (pollHandle) clearInterval(pollHandle);
      if (channel) supabase.removeChannel(channel);
      if (typingChannel) supabase.removeChannel(typingChannel);
      typingChannelRef.current = null;
    };
  }, [authorized, supabase, tenantId, conversationId, open]);

  useEffect(() => {
    if (!authorized || !supabase || !viewingConversationId) return;

    const loadViewingMessages = async () => {
      const { data: messageData, error: messageError } = await supabase
        .from('messages')
        .select('id, tenant_id, conversation_id, sender_type, body, created_at')
        .eq('conversation_id', viewingConversationId)
        .order('created_at', { ascending: true });

      if (messageError) {
        setStatusMessage(messageError.message);
        return;
      }

      setViewingMessages(messageData ?? []);
    };

    loadViewingMessages();
  }, [authorized, supabase, viewingConversationId]);

  // Notify the parent iframe to resize when the chat opens or closes.
  useEffect(() => {
    try {
      if (window.parent && window.parent !== window) {
        const target = expectedParentOrigin ?? '*';
        window.parent.postMessage({ type: 'widget-resize', open }, target);
      }
    } catch {
      // Cross-origin postMessage failures are non-fatal.
    }
  }, [open, expectedParentOrigin]);

  useEffect(() => {
    if (!open || !conversationId) return;
    const lastReadAt = localStorage.getItem(getLastReadKey(conversationId));
    setUnreadCutoff(lastReadAt);
    setUnreadCount(0);
  }, [open, conversationId]);

  useEffect(() => {
    if (!open || !conversationId) return;
    const latest = messages[messages.length - 1]?.created_at;
    if (latest) {
      localStorage.setItem(getLastReadKey(conversationId), latest);
    }
  }, [messages, open, conversationId]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distanceFromBottom < 40);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !open) return;

    if (!didInitialScroll) {
      container.scrollTop = container.scrollHeight;
      setDidInitialScroll(true);
      return;
    }

    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, open, isAtBottom, didInitialScroll]);

  useEffect(() => {
    if (!body.trim() || !conversationId || isViewingPrevious) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 900) return;
    lastTypingSentRef.current = now;

    typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { sender: 'visitor' },
    });
  }, [body, conversationId, isViewingPrevious]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!conversationId || !body.trim() || isViewingPrevious) return;

    if (!supabase) {
      setStatusMessage('Missing Supabase environment variables.');
      return;
    }

    if (!visitorId) {
      setStatusMessage('Missing visitor session.');
      return;
    }

    let targetConversationId = conversationId;

    if (activeConversation?.status === 'closed') {
      if (!visitorId) {
        setStatusMessage('Missing visitor session.');
        return;
      }

      const created = await createConversation(visitorId, 'Support request');
      if (!created) return;

      setPreviousConversations((prev) =>
        activeConversation ? [activeConversation, ...prev] : prev,
      );
      setActiveConversation(created);
      setConversationId(created.id);
      setViewingConversationId(null);
      setViewingMessages([]);
      setMessages([]);
      setUnreadCount(0);
      setUnreadCutoff(null);
      setStatusMessage('');
      targetConversationId = created.id;
    }

    const nextBody = body.trim();
    setBody('');
    setSending(true);

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: widgetToken,
          tenant_id: tenantId,
          conversation_id: targetConversationId,
          visitor_id: visitorId,
          sender_type: 'visitor',
          body: nextBody,
        }),
      });

      const responseData = (await response.json()) as {
        data?: Message;
        error?: string;
      };

      if (!response.ok) {
        setStatusMessage(responseData.error ?? 'Unable to send message.');
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => {
          setStatusMessage('');
        }, 2000);
        setSending(false);
        return;
      }

      if (responseData.data) appendMessage(setMessages, responseData.data);
      setSending(false);
    } catch {
      setStatusMessage('Unable to send message.');
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => {
        setStatusMessage('');
      }, 2000);
      setSending(false);
    }
  };

  const handleViewConversation = (conversation: Conversation) => {
    setViewingConversationId(conversation.id);
    setViewingMessages([]);
    setShowPreviousList(false);
  };

  const handleBackToCurrent = () => {
    setViewingConversationId(null);
    setViewingMessages([]);
  };

  if (!authorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 p-4 text-sm text-zinc-600">
        {statusMessage}
      </div>
    );
  }

  return (
    <div className="pointer-events-none">
      <div className="fixed bottom-4 right-4 flex flex-col items-end gap-2 pointer-events-none">
        {open ? (
          <div className="pointer-events-auto flex h-[70vh] w-[90vw] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl ring-1 ring-black/5 sm:h-[480px] sm:w-[320px]">
            <div className="flex items-center justify-between bg-gradient-to-r from-[color:var(--primary)] to-zinc-800 px-4 py-3 text-[color:var(--primary-foreground)]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Live support</span>
                {activeConversation?.subject ? (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/90">
                    {activeConversation.subject}
                  </span>
                ) : null}
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/90">
                  {initializing ? 'Connecting' : 'Online'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isViewingPrevious ? (
                  <button
                    type="button"
                    onClick={handleBackToCurrent}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10 hover:text-white"
                    aria-label="Back to current conversation"
                    title="Back to current"
                  >
                    Ã—
                  </button>
                ) : null}
                <ThemeToggle />
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10 hover:text-white"
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                >
                  Ã—
                </button>
              </div>
            </div>
            {statusMessage ? (
              <div
                className="border-b border-[color:var(--border)] bg-amber-50 px-4 py-2 text-xs text-amber-700"
                role="status"
                aria-live="polite"
              >
                {statusMessage}
              </div>
            ) : null}
            <div
              ref={messagesContainerRef}
              className="relative flex-1 space-y-3 overflow-y-auto bg-[color:var(--muted)] p-3 text-sm sm:p-4"
            >
              {initializing ? (
                <div className="space-y-3">
                  <div className="h-4 w-2/3 animate-pulse rounded-full bg-[color:var(--border)]" />
                  <div className="h-4 w-1/2 animate-pulse rounded-full bg-[color:var(--border)]" />
                  <div className="h-4 w-3/5 animate-pulse rounded-full bg-[color:var(--border)]" />
                </div>
              ) : showPreviousList && !isViewingPrevious ? (
                <div className="space-y-2">
                  {previousConversations.length === 0 ? (
                    <p className="text-xs text-[color:var(--muted-foreground)]">
                      No previous conversations yet.
                    </p>
                  ) : (
                    previousConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => handleViewConversation(conversation)}
                        className="flex w-full items-center justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-left text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[color:var(--foreground)]">
                            {conversation.subject ?? 'Support request'}
                          </p>
                          <p className="text-[color:var(--muted-foreground)]">
                            {new Date(
                              conversation.last_activity_at ?? conversation.created_at,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            conversation.status === 'resolved'
                              ? 'bg-emerald-100 text-emerald-700'
                              : conversation.status === 'closed'
                                ? 'bg-zinc-200 text-zinc-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {conversation.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : displayedMessages.length === 0 ? (
                <p className="text-[color:var(--muted-foreground)]">
                  {isViewingPrevious ? 'No messages in this conversation.' : 'How can I help?'}
                </p>
              ) : (
                displayedMessages.map((message, index) => {
                  const previous = index > 0 ? displayedMessages[index - 1] : null;
                  const shouldShowUnreadDivider =
                    !isViewingPrevious &&
                    unreadCutoff &&
                    message.sender_type === 'agent' &&
                    message.created_at > unreadCutoff &&
                    (!previous || previous.created_at <= unreadCutoff);

                  return (
                    <div key={message.id}>
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
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] shadow-sm ${
                          message.sender_type === 'visitor'
                            ? 'ml-auto bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
                            : 'bg-[color:var(--card)] text-[color:var(--foreground)]'
                        }`}
                      >
                        {message.body}
                      </div>
                    </div>
                  );
                })
              )}
              {!isAtBottom && displayedMessages.length > 0 ? (
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
            <div className="border-t border-[color:var(--border)] bg-[color:var(--card)] p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {activeConversation?.status === 'resolved' && !isViewingPrevious ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">
                    âœ… Resolved â€” reply to reopen
                  </span>
                ) : null}
                {activeConversation?.status === 'closed' && !isViewingPrevious ? (
                  <span className="rounded-full bg-zinc-200 px-3 py-1 font-semibold text-zinc-700">
                    Closed â€” a new conversation will start on reply
                  </span>
                ) : null}
                {isViewingPrevious ? (
                  <span className="rounded-full bg-zinc-200 px-3 py-1 font-semibold text-zinc-700">
                    Viewing previous conversation
                  </span>
                ) : null}
              </div>
            </div>
            {showPreviousList && !isViewingPrevious ? null : (
              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 border-t border-[color:var(--border)] bg-[color:var(--card)] p-3"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <input
                    type="text"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={
                      isViewingPrevious ? 'Read-only conversation' : 'Type your message...'
                    }
                    className="flex-1 rounded-full border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    disabled={sending || isViewingPrevious}
                    aria-label="Message"
                  />
                  {remoteTyping && !isViewingPrevious ? (
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      Agent is typing...
                    </span>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className={`rounded-full px-4 py-2 text-sm font-medium text-[color:var(--primary-foreground)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                    sending || !body.trim() || isViewingPrevious
                      ? 'cursor-not-allowed bg-zinc-400'
                      : 'bg-[color:var(--primary)] hover:bg-zinc-800'
                  }`}
                  disabled={sending || !body.trim() || isViewingPrevious}
                >
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </form>
            )}
            <div className="border-t border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowPreviousList((prev) => !prev)}
                  className="text-xs font-medium text-[color:var(--muted-foreground)]"
                >
                  {showPreviousList ? 'Hide' : 'Show'} previous conversations
                </button>
                {isViewingPrevious ? (
                  <button
                    type="button"
                    onClick={handleBackToCurrent}
                    className="text-xs font-semibold text-[color:var(--accent)]"
                  >
                    Back to current conversation
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-tr from-[color:var(--primary)] to-zinc-700 text-sm font-semibold text-[color:var(--primary-foreground)] shadow-lg ring-1 ring-black/10 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          aria-label={open ? 'Close chat' : 'Open chat'}
          aria-expanded={open}
        >
          {open ? 'Ã—' : 'Chat'}
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[11px] font-semibold text-[color:var(--accent-foreground)]">
              {unreadCount}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

export default function WidgetPage() {
  return (
    <Suspense fallback={null}>
      <WidgetContent />
    </Suspense>
  );
}

async function ensureAnonId(supabase: ReturnType<typeof getSupabaseClient>) {
  if (!supabase) return { userId: null, error: 'Missing Supabase client.' };

  const cached = localStorage.getItem(ANON_STORAGE_KEY);
  if (cached) return { userId: cached, error: null };

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return { userId: null, error: sessionError.message };

  if (!sessionData.session) {
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) return { userId: null, error: signInError.message };
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.getSession();
  if (refreshError) return { userId: null, error: refreshError.message };

  const userId = refreshed.session?.user?.id ?? null;
  if (userId) localStorage.setItem(ANON_STORAGE_KEY, userId);
  return { userId, error: null };
}
