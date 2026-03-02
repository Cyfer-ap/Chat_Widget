# Dynamic Chat Widget

A copy-paste live chat widget for any website plus an agent dashboard to handle conversations in realtime — with full ticketing (open → resolved → closed) workflow.

---

## What is included

| Area | Route / File |
|---|---|
| Widget (visitor side) | `/widget` — loads inside an iframe |
| Agent login | `/login` |
| Agent inbox | `/dashboard` |
| Conversation view | `/dashboard/conversations/[id]` |
| Embed loader script | `/public/widget.js` |
| Supabase schema & RLS | `/supabase/migrations/` and `/supabase/rls.sql` |

---

## Quick start

### 1 — Install dependencies

```powershell
npm install
```

### 2 — Set up Supabase

Create a Supabase project, then run the migrations **in order** in the Supabase SQL editor:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_conversations_last_message_at.sql
supabase/migrations/0003_reopen_resolved_on_visitor_message.sql
supabase/migrations/0004_ticketing_fields_and_triggers.sql
```

Then apply RLS policies:

```
supabase/rls.sql
```

Enable **Realtime** on the `messages` and `conversations` tables in the Supabase dashboard.

Seed a demo tenant and agent:

```
supabase/seed.sql
```

### 3 — Add environment variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 4 — Run the dev server

```powershell
npm run dev
```

Open `http://localhost:3000`.

---

## Widget embed snippet

Copy-paste into any HTML page:

```html
<script
  src="https://your-app.com/widget.js"
  data-tenant="YOUR_TENANT_ID"
  data-host="https://your-app.com"
  data-title="Live support"
  data-width="360"
  data-height="600"
></script>
```

The script creates a fixed bottom-right iframe. It reads `document.referrer` and calls `/api/tenant/authorize` to verify the embedding domain against the `tenant_sites` allowlist before rendering anything.

---

## Embedding security headers

The `/widget` route emits a dynamic `Content-Security-Policy` header with a `frame-ancestors` directive derived from the signed widget token. If the token is missing or invalid, the policy falls back to `frame-ancestors 'none'` to prevent embedding.

---

## Features

### Widget (visitor side)

- **Anonymous session** — visitors sign in anonymously via Supabase Auth; their `auth.uid()` is stored in `visitors.anon_id` in `localStorage`.
- **Smart ticket selection** — on load the widget picks the most recent **open** or **pending** conversation. If all conversations are resolved/closed and the threshold has passed, a new ticket is created automatically.
- **Auto new ticket** — when a visitor sends a message on a closed conversation, a new ticket is created automatically (no manual button needed).
- **Previous conversations** — a "Show previous conversations" toggle replaces the full message area with a list of past tickets (subject, date, status). Tapping one opens a read-only thread. An **×** button in the header returns to the current conversation.
- **Resolved banner** — shows "✅ Resolved — reply to reopen" when the active ticket is resolved.
- **Closed banner** — shows "Closed — a new conversation will start on reply" when the ticket is closed.
- **Realtime messages** — Supabase Realtime subscription + 5-second poll fallback.
- **Unread badge** — floating button shows unread count while chat is closed.
- **"Unread messages" divider** — displayed in the chat thread above the first unseen agent message.
- **Typing indicator** — agent typing is shown in the widget; visitor typing is shown in the dashboard.
- **Rate limiting** — max 8 messages per 60-second window (client-side).
- **Dark / light mode** — toggle in the widget header; dark is default.
- **Scroll-to-latest** button when not at the bottom.

### Agent dashboard (`/dashboard`)

- **Default filter: Open** — inbox shows open conversations by default with tabs for Resolved, Closed, and All.
- **Messages-only list** — conversations without any messages are hidden from the inbox (no empty chats).
- **Realtime inbox** — new messages surface conversations in the list instantly without a full page reload.
- **Background refresh** — the "Refreshing…" indicator appears as a small corner badge so the list never goes blank.
- **Unread counters** — unread visitor messages are counted per conversation and shown as a badge.
- **Relative timestamps** — last message time shown as "now", "5m", "2h", "3d", etc.
- **Search** — filter by tenant ID.

### Conversation view (`/dashboard/conversations/[id]`)

- Full message thread with day separators and timestamps.
- **Resolve / Reopen** toggle button (open ↔ resolved).
- **Close** button — requires confirmation prompt; permanently locks the conversation (cannot be reopened once closed).
- **Closed conversations** — the Reopen button is disabled; only resolved conversations can be reopened.
- **Typing indicator** — shows "Visitor is typing…" when the visitor is composing.
- **Scroll-to-latest** button.

---

## Ticketing workflow

```
Visitor sends first message
        ↓
  Ticket created (status: open)
        ↓
Agent replies / resolves
        ↓
  status: resolved
        ↓
Visitor replies within 7 days   →  status: open  (re-opened)
Visitor replies after 14 days   →  new ticket created
        ↓
Agent closes conversation
        ↓
  status: closed  (permanent — cannot reopen)
Any new visitor message         →  new ticket created automatically
```

**Key thresholds (configurable in `src/app/widget/page.tsx`):**

| Constant | Default | Meaning |
|---|---|---|
| `REOPEN_WINDOW_DAYS` | 7 | Visitor can reopen a resolved ticket within this window |
| `NEW_TICKET_AFTER_DAYS` | 14 | After this many days, a new ticket is always created |

---

## Database schema (summary)

All tables carry `tenant_id` for multi-tenant isolation.

| Table | Key columns |
|---|---|
| `tenants` | `id`, `name`, `created_at` |
| `tenant_sites` | `id`, `tenant_id`, `allowed_domain` |
| `agents` | `id`, `tenant_id`, `user_id`, `role` |
| `visitors` | `id`, `tenant_id`, `anon_id`, `last_seen` |
| `conversations` | `id`, `tenant_id`, `visitor_id`, `status`, `subject`, `created_at`, `last_message_at`, `last_activity_at`, `resolved_at` |
| `messages` | `id`, `tenant_id`, `conversation_id`, `sender_type`, `body`, `created_at` |

**Conversation statuses:** `open` → `pending` → `resolved` → `closed`

**DB triggers (migration 0004):**
- `messages_set_last_message_at` — updates `last_message_at` and `last_activity_at` on every new message.
- `conversations_set_resolved_at` — stamps `resolved_at` when status changes to `resolved`; clears it on reopen.
- `messages_reopen_conversation` — automatically reopens a `resolved` or `pending` conversation when a visitor sends a new message.

---

## Supabase notes

- RLS policies in `/supabase/rls.sql` ensure agents only access their tenant's data and visitors only access their own conversations.
- Visitors sign in anonymously; their Supabase `auth.uid()` is stored in `visitors.anon_id`.
- For MVP testing you can temporarily disable RLS or use the service role key for server-side checks.
- Domain allowlist is enforced via `/api/tenant/authorize` using the service role key.

---

## Development scripts

```powershell
npm run dev     # start dev server
npm run build   # production build
npm run lint    # ESLint check
npm run test    # Node test runner
```

---

## Known MVP trade-offs

- Client-side rate limiting (not server-enforced).
- No email/push notifications for offline agents.
- No agent assignment or presence (online/offline) tracking yet.
- File/image attachments not yet implemented.
- Auto-close after 7 days resolved is not yet a scheduled job (would need a Supabase Edge Function or cron).
