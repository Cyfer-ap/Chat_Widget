-- supabase/rls.sql
-- RLS policies for Chat_Widget (multi-tenant + widget + agent dashboard)
-- Designed to NOT break current workflow:
-- - Widget inserts/selects visitors + conversations via anon-authenticated client
-- - Visitor messages are sent via /api/messages/send (service role), NOT direct inserts
-- - Agents read/insert via authenticated supabase client
-- -----------------------------
-- Enable RLS
-- -----------------------------
alter table
  public.tenants enable row level security;


alter table
  public.tenant_sites enable row level security;


alter table
  public.agents enable row level security;


alter table
  public.visitors enable row level security;


alter table
  public.conversations enable row level security;


alter table
  public.messages enable row level security;


-- Server/control tables (deny-by-default via RLS; service_role bypasses)
alter table if exists
  public.rate_limit_log enable row level security;


alter table if exists
  public.bootstrap_log enable row level security;


alter table if exists
  public.agent_invites enable row level security;


alter table if exists
  public.audit_logs enable row level security;


-- -----------------------------
-- Drop existing policies (safe to re-run)
-- -----------------------------
-- tenants
drop policy
  if exists "Agents can read tenant data" on public.tenants;


-- tenant_sites
drop policy
  if exists "Agents can read sites" on public.tenant_sites;


drop policy
  if exists "Admins can insert tenant sites" on public.tenant_sites;


drop policy
  if exists "Admins can delete tenant sites" on public.tenant_sites;


-- agents
drop policy
  if exists "Agents can read their agent row" on public.agents;


-- visitors
drop policy
  if exists "Agents can read visitors" on public.visitors;


drop policy
  if exists "Visitors can read their visitor record" on public.visitors;


drop policy
  if exists "Visitors can insert their visitor record" on public.visitors;


-- conversations
drop policy
  if exists "Agents can read conversations" on public.conversations;


drop policy
  if exists "Agents can update conversations" on public.conversations;


drop policy
  if exists "Visitors can insert conversations" on public.conversations;


drop policy
  if exists "Visitors can read their conversations" on public.conversations;


-- messages
drop policy
  if exists "Agents can read messages" on public.messages;


drop policy
  if exists "Agents can insert messages" on public.messages;


drop policy
  if exists "Visitors can read their messages" on public.messages;


drop policy
  if exists "Visitors can insert messages" on public.messages;


-- just in case older DBs still have it
-- -----------------------------
-- AGENT POLICIES
-- -----------------------------
-- Agents can read tenant rows for tenants they belong to
create policy
  "Agents can read tenant data" on public.tenants for
select
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = tenants.id
        and a.user_id = auth.uid ()
    )
  );


-- Agents can read allowlisted domains (tenant_sites) for their tenant
create policy
  "Agents can read sites" on public.tenant_sites for
select
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = tenant_sites.tenant_id
        and a.user_id = auth.uid ()
    )
  );


-- Settings page currently does client-side insert/delete into tenant_sites.
-- Allow only admins to do that.
create policy
  "Admins can insert tenant sites" on public.tenant_sites for insert
with
  check (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = tenant_sites.tenant_id
        and a.user_id = auth.uid ()
        and a.role = 'admin'
    )
  );


create policy
  "Admins can delete tenant sites" on public.tenant_sites for delete using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = tenant_sites.tenant_id
        and a.user_id = auth.uid ()
        and a.role = 'admin'
    )
  );


-- Dashboard loads tenant access by querying agents for current user_id.
-- Allow agents to read ONLY their own agent rows.
create policy
  "Agents can read their agent row" on public.agents for
select
  using (agents.user_id = auth.uid ());


-- Agents can read visitors/conversations/messages within their tenant
create policy
  "Agents can read visitors" on public.visitors for
select
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = visitors.tenant_id
        and a.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read conversations" on public.conversations for
select
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = conversations.tenant_id
        and a.user_id = auth.uid ()
    )
  );


-- Agents can update conversations (status changes, subject edits, etc.) in their tenant
create policy
  "Agents can update conversations" on public.conversations for
update
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = conversations.tenant_id
        and a.user_id = auth.uid ()
    )
  )
with
  check (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = conversations.tenant_id
        and a.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read messages" on public.messages for
select
  using (
    exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = messages.tenant_id
        and a.user_id = auth.uid ()
    )
  );


-- Agents can insert agent messages in conversations belonging to their tenant
create policy
  "Agents can insert messages" on public.messages for insert
with
  check (
    messages.sender_type = 'agent'
    and exists (
      select
        1
      from
        public.agents a
      where
        a.tenant_id = messages.tenant_id
        and a.user_id = auth.uid ()
    )
    and exists (
      select
        1
      from
        public.conversations c
      where
        c.id = messages.conversation_id
        and c.tenant_id = messages.tenant_id
    )
  );


-- -----------------------------
-- VISITOR POLICIES (anonymous authenticated)
-- -----------------------------
-- Visitors can read/insert ONLY their own visitor row based on anon_id == auth.uid()::text
create policy
  "Visitors can read their visitor record" on public.visitors for
select
  using (visitors.anon_id = auth.uid ()::text);


create policy
  "Visitors can insert their visitor record" on public.visitors for insert
with
  check (visitors.anon_id = auth.uid ()::text);


-- Visitors can create conversations only for their own visitor row + same tenant, and only open
create policy
  "Visitors can insert conversations" on public.conversations for insert
with
  check (
    conversations.status = 'open'
    and exists (
      select
        1
      from
        public.visitors v
      where
        v.id = conversations.visitor_id
        and v.anon_id = auth.uid ()::text
        and v.tenant_id = conversations.tenant_id
    )
  );


-- Visitors can read only their conversations (tenant-consistent)
create policy
  "Visitors can read their conversations" on public.conversations for
select
  using (
    exists (
      select
        1
      from
        public.visitors v
      where
        v.id = conversations.visitor_id
        and v.anon_id = auth.uid ()::text
        and v.tenant_id = conversations.tenant_id
    )
  );


-- Visitors can read messages only for their conversations (tenant-consistent)
create policy
  "Visitors can read their messages" on public.messages for
select
  using (
    exists (
      select
        1
      from
        public.conversations c
        join public.visitors v on v.id = c.visitor_id
      where
        c.id = messages.conversation_id
        and c.tenant_id = messages.tenant_id
        and v.anon_id = auth.uid ()::text
    )
  );


-- IMPORTANT:
-- Intentionally NO visitor INSERT policy on public.messages.
-- Visitor message writes must go through /api/messages/send (service role),
-- so you keep widget-token validation + server-side rate limiting + closed-convo enforcement.
-- -----------------------------
-- SERVER-ONLY TABLES
-- -----------------------------
-- rate_limit_log, bootstrap_log, agent_invites, audit_logs have RLS enabled
-- and NO policies, so they are deny-by-default for anon/authenticated users.
-- Your server routes using the service_role key can still read/write them.