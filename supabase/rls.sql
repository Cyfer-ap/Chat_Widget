-- Enable RLS on all exposed tables
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


-- Also lock down “server-only” tables (created in later migrations)
alter table
  public.rate_limit_log enable row level security;


alter table
  public.bootstrap_log enable row level security;


alter table
  public.agent_invites enable row level security;


-- Drop existing policies (safe to re-run)
drop policy
  if exists "Agents can read tenant data" on public.tenants;


drop policy
  if exists "Agents can read sites" on public.tenant_sites;


drop policy
  if exists "Agents can read agents" on public.agents;


drop policy
  if exists "Agents can read their agent row" on public.agents;


drop policy
  if exists "Agents can read visitors" on public.visitors;


drop policy
  if exists "Agents can read conversations" on public.conversations;


drop policy
  if exists "Agents can update conversations" on public.conversations;


drop policy
  if exists "Agents can read messages" on public.messages;


drop policy
  if exists "Agents can insert messages" on public.messages;


drop policy
  if exists "Visitors can read their visitor record" on public.visitors;


drop policy
  if exists "Visitors can insert their visitor record" on public.visitors;


drop policy
  if exists "Visitors can insert conversations" on public.conversations;


drop policy
  if exists "Visitors can read their conversations" on public.conversations;


drop policy
  if exists "Visitors can read their messages" on public.messages;


-- -------------------------------------------------------------------
-- AGENT POLICIES
-- -------------------------------------------------------------------
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


-- Agents can read allowed sites for their tenant
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


-- IMPORTANT: dashboard queries public.agents to find tenant_ids
-- Allow any logged-in agent to read only their own agent rows.
create policy
  "Agents can read their agent row" on public.agents for
select
  using (agents.user_id = auth.uid ());


-- (Optional) If later you build an admin UI to list all agents in tenant:
-- create policy "Admins can read agents in their tenant"
-- on public.agents
-- for select
-- using (
--   exists (
--     select 1 from public.agents me
--     where me.tenant_id = agents.tenant_id
--       and me.user_id = auth.uid()
--       and me.role = 'admin'
--   )
-- );
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


-- Agents can update conversations in their tenant (status changes)
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


-- Agents can insert agent messages for conversations in their tenant
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


-- -------------------------------------------------------------------
-- VISITOR POLICIES (anonymous signed-in visitors)
-- -------------------------------------------------------------------
-- Visitors can read/insert ONLY their own visitor row (identified by anon_id == auth.uid()::text)
create policy
  "Visitors can read their visitor record" on public.visitors for
select
  using (visitors.anon_id = auth.uid ()::text);


create policy
  "Visitors can insert their visitor record" on public.visitors for insert
with
  check (visitors.anon_id = auth.uid ()::text);


-- Visitors can create conversations only for their own visitor row + same tenant
-- (Widget inserts status='open' which is allowed)
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


-- Visitors can read their conversations
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


-- NOTE:
-- Intentionally NO visitor INSERT policy on public.messages.
-- Visitor message writes must go through /api/messages/send (service role),
-- so you keep token validation + server-side rate limiting + closed-convo rules.
-- -------------------------------------------------------------------
-- SERVER-ONLY TABLES
-- -------------------------------------------------------------------
-- By enabling RLS and NOT adding policies, these tables are "deny by default"
-- for anon/authenticated clients, but still accessible to service_role (your API routes).
-- Tables: rate_limit_log, bootstrap_log, agent_invites