# Dynamic Chat Widget

Copy-paste live chat widget for any website plus an agent dashboard to reply in realtime.

## What is included

- Widget UI at `/widget` (iframe-friendly)
- Agent login at `/login`
- Inbox at `/dashboard`
- Conversation view at `/dashboard/conversations/[id]`
- Embed loader script at `/public/widget.js`
- Supabase schema + RLS policies under `/supabase`

## Quick start

1) Install dependencies (already done if you used `create-next-app`).
2) Create a Supabase project and apply the SQL in `/supabase/migrations/0001_init.sql`.
3) Apply `/supabase/rls.sql` and enable Realtime on the `messages` table.
4) Create a demo tenant using `/supabase/seed.sql`.
5) Add environment variables (see below).
6) Run the dev server.

```powershell
npm run dev
```

Then open `http://localhost:3000`.

## Environment variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Widget embed snippet

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

## Supabase notes

- Every table is tenant-scoped with `tenant_id`.
- RLS policies in `/supabase/rls.sql` assume:
  - Agents are mapped in the `agents` table to `auth.users`.
  - Visitors sign in anonymously; their Supabase `auth.uid()` is stored in `visitors.anon_id`.
- For MVP testing, you can temporarily disable RLS or use the service role key for server-side checks.

## Development scripts

```powershell
npm run lint
```

## Known MVP trade-offs

- Rate limiting is a client-side throttle (see `src/app/widget/page.tsx`).
- Domain allowlist is enforced via `/api/tenant/authorize` with the service role key.
- Agent assignment and presence are not yet implemented.
