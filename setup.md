# Setup & Onboarding Guide (Detailed)

This guide walks through every step to add a new client (tenant), allow their website to embed the widget, and provision an agent login scoped to that tenant. Each step includes copy-paste SQL templates and example curl / PowerShell commands. Follow steps in order.

IMPORTANT: Always run SQL in the Supabase SQL editor for your project. Be careful with secrets (do not paste them publicly). If you are unsure which Supabase project the deployed app uses, check `NEXT_PUBLIC_SUPABASE_URL` in your deployment environment.

Table of contents
- Prerequisites
- Create tenant (SQL)
- Allowlist embedding domain (SQL)
- Create agent user (Supabase UI or Admin API)
- Link agent to tenant (SQL) or invite flow (recommended)
- Embed the widget (HTML snippet)
- Verify authorize flow (curl / PowerShell)
- Verify agent dashboard access
- Troubleshooting (DNS/TLS/CORS)
- Revoke & rotate keys (security)

---

Prerequisites
- Supabase project with migrations applied (see `supabase/migrations/` and `supabase/rls.sql`).
- The deployment host for your widget (e.g., `https://chat-widget-qqhh.vercel.app`).
- Admin access to Supabase (or an admin user in `agents` for an existing tenant) to create tenants and invites.

---

1) Create tenant (SQL)

Run this in Supabase SQL editor to create a tenant. Replace `NEW_TENANT_NAME` with a readable name.

```sql
INSERT INTO public.tenants (name)
VALUES ('NEW_TENANT_NAME')
RETURNING id, name, created_at;
```

Copy the returned `id` (this is `NEW_TENANT_ID`). Use this exact UUID in later steps.

Optional: create tenant with a fixed id (advanced):

```sql
INSERT INTO public.tenants (id, name)
VALUES ('NEW_TENANT_ID', 'NEW_TENANT_NAME');
```

---

2) Allowlist embedding domain (SQL)

Add the domain where the widget will be embedded. Use hostname only (no protocol, no trailing slash):

```sql
INSERT INTO public.tenant_sites (tenant_id, allowed_domain)
VALUES ('NEW_TENANT_ID', 'newclient.example.com');
```

If you need to allow `localhost` for local testing, add:

```sql
INSERT INTO public.tenant_sites (tenant_id, allowed_domain)
VALUES ('NEW_TENANT_ID', 'localhost');
```

---

3) Create agent user

Option A (recommended): create user via Supabase Console (Authentication → Users)
- Email: agent@example.com
- Password: (choose secure password)

Copy the created user's `id` from Supabase (AUTH USER UUID) — call it `AGENT_USER_ID`.

Option B: create user using Supabase Admin API (service role key)

Use your service role key carefully; this creates a new user programmatically.

```bash
curl -X POST 'https://<SUPABASE_PROJECT>.supabase.co/auth/v1/admin/users' \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@example.com","password":"StrongPa$$w0rd","email_confirm":true}'
```

The response includes `id` — use that as `AGENT_USER_ID`.

---

4a) Link agent to tenant directly (SQL)

This is the fastest way to ensure the user can access the tenant's dashboard. Replace the placeholders exactly.

```sql
INSERT INTO public.agents (tenant_id, user_id, role)
VALUES ('NEW_TENANT_ID', 'AGENT_USER_ID', 'agent');
```

Verify:

```sql
SELECT id, tenant_id, user_id, role, created_at
FROM public.agents
WHERE tenant_id = 'NEW_TENANT_ID';
```

---

4b) Invite flow (recommended for production)

Steps:
1. Admin (existing admin user) requests invite via API.
2. API returns a token or invite URL.
3. Agent signs up or signs in and redeems invite (the login page auto-redeem logic will call the accept-invite endpoint once signed in).

Admin call (PowerShell example):

```powershell
$uri = 'https://chat-widget-qqhh.vercel.app/api/agents/invite'
$headers = @{ 'Authorization' = 'Bearer <ADMIN_ACCESS_TOKEN>'; 'Content-Type' = 'application/json' }
$body = @{ tenant_id = 'NEW_TENANT_ID'; email = 'agent@example.com'; role = 'agent' } | ConvertTo-Json
Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
```

Response:
```
{ "token": "<INVITE_TOKEN>", "invite_url": "https://chat-widget-qqhh.vercel.app/invite?token=<INVITE_TOKEN>", ... }
```

Agent redeem (after signing in; login UI auto-redeems). Manual redeem via curl/PowerShell:

```bash
curl -X POST "https://chat-widget-qqhh.vercel.app/api/agents/accept-invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AGENT_ACCESS_TOKEN>" \
  -d '{"token":"<INVITE_TOKEN>"}'
```

---

5) Embed the widget (client site)

Add loader snippet to the target site (replace NEW_TENANT_ID and WIDGET_HOST):

```html
<script
  src="https://chat-widget-qqhh.vercel.app/widget.js"
  data-tenant="NEW_TENANT_ID"
  data-host="https://chat-widget-qqhh.vercel.app"
  data-title="Support"
  data-width="360"
  data-height="600"
></script>
```

---

6) Verify authorize flow (PowerShell / curl)

This confirms the server will return an authorized token for the embedding origin.

PowerShell (run from anywhere, simulating the embed Origin header):

```powershell
$origin = 'https://newclient.example.com'
$tenant = 'NEW_TENANT_ID'
Invoke-RestMethod -Uri "https://chat-widget-qqhh.vercel.app/api/tenant/authorize?tenant=$tenant" -Headers @{ Origin = $origin } -Method Get
```

curl (bash):

```bash
curl -H "Origin: https://newclient.example.com" "https://chat-widget-qqhh.vercel.app/api/tenant/authorize?tenant=NEW_TENANT_ID"
```

Expected response:

```json
{ "authorized": true, "token": "<WIDGET_TOKEN>" }
```

If `authorized:false` returned, check `tenant_sites` rows and ensure the request Origin hostname matches the allowed_domain.

---

7) Verify agent dashboard access

- Sign in as the agent at https://chat-widget-qqhh.vercel.app/login with the agent credentials.
- Open https://chat-widget-qqhh.vercel.app/dashboard. The Tenant ID field should be prefilled and read-only (if the agent has a single tenant) and the inbox should show only conversations for `NEW_TENANT_ID`.

To verify server-side enforcement, use the agent access token to attempt to fetch conversations for a different tenant — RLS should block you. Example (JS console after login):

```js
const supabase = window.supabase; // or createClient with NEXT_PUBLIC_* keys
const { data, error } = await supabase.from('conversations').select('*').eq('tenant_id', 'OTHER_TENANT_ID');
console.log({ data, error });
```

Expected: `data` should be empty or `error` should show permission denied.

---

8) Troubleshooting

8.1 DNS/TLS interception (ISP/Corp proxy) — symptoms: "Failed to fetch" in Chrome, or certificate warnings when opening your Supabase host.
- Quick test: in PowerShell run:

```powershell
nslookup pcnaxjvtmlhyygmxgivd.supabase.co 1.1.1.1
```

- If DNS resolves to an unexpected IP and TLS cert is not for the supabase host, your network intercepts TLS. Fix by switching to public DNS (1.1.1.1) or using a different network (mobile hotspot) during setup.

8.2 CORS errors — symptom: "blocked by CORS policy" in Chrome console.
- Solution: add all relevant origins to Supabase Auth → Settings → Allowed request origins (include the dashboard and widget origins).

8.3 Invite redemption / role errors
- If `/api/agents/invite` returns `Admin role required.`, the token used is not for an admin. Use an admin user's access_token or run the SQL to insert an `agents` row directly.

---

9) Revoke & rotate keys (security)

If you ever exposed `SUPABASE_SERVICE_ROLE_KEY` or other secrets, rotate them immediately in the Supabase dashboard and update your deployment envs (Vercel). Also rotate `WIDGET_TOKEN_SECRET` and `BOOTSTRAP_ADMIN_SECRET` in your deployment environment.

---

10) Common SQL snippets (copy/paste)

Create tenant (explicit id):

```sql
INSERT INTO public.tenants (id, name)
VALUES ('32edbede-8c1a-42a4-9211-1dd52e4ce0b3', 'Portfolio Tenant');
```

Add allowed domain:

```sql
INSERT INTO public.tenant_sites (tenant_id, allowed_domain)
VALUES ('32edbede-8c1a-42a4-9211-1dd52e4ce0b3', 'portfolio-ten-peach-58.vercel.app');
```

Insert agent by email (if user exists):

```sql
INSERT INTO public.agents (tenant_id, user_id, role)
SELECT '32edbede-8c1a-42a4-9211-1dd52e4ce0b3'::uuid, id, 'agent'
FROM auth.users
WHERE email = 'cyferabhinav.ap@gmail.com';
```

Direct agent insert by UUID:

```sql
INSERT INTO public.agents (tenant_id, user_id, role)
VALUES ('32edbede-8c1a-42a4-9211-1dd52e4ce0b3', 'fb919f67-1918-44a6-93a7-01313b40eed6', 'agent');
```

Check agent rows for tenant:

```sql
SELECT id, tenant_id, user_id, role, created_at
FROM public.agents
WHERE tenant_id = '32edbede-8c1a-42a4-9211-1dd52e4ce0b3';
```

---

If you want, I can also:
- Create a small onboarding checklist script (Node.js) that runs the SQL via Supabase admin API to automate tenant creation and agent invites (requires service role key).
- Add a small UI page in the dashboard to manage tenant allowlist and invites.


---

End of setup guide

