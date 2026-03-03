alter table
  tenants enable row level security;


alter table
  tenant_sites enable row level security;


alter table
  agents enable row level security;


alter table
  visitors enable row level security;


alter table
  conversations enable row level security;


alter table
  messages enable row level security;


-- Drop policies so this file can be re-run safely.
drop policy
  if exists "Agents can read tenant data" on tenants;


drop policy
  if exists "Agents can read sites" on tenant_sites;


drop policy
  if exists "Agents can read visitors" on visitors;


drop policy
  if exists "Agents can read conversations" on conversations;


drop policy
  if exists "Agents can update conversations" on conversations;


drop policy
  if exists "Agents can read messages" on messages;


drop policy
  if exists "Agents can insert messages" on messages;


drop policy
  if exists "Visitors can read their visitor record" on visitors;


drop policy
  if exists "Visitors can insert their visitor record" on visitors;


drop policy
  if exists "Visitors can insert conversations" on conversations;


drop policy
  if exists "Visitors can read their conversations" on conversations;


drop policy
  if exists "Visitors can read their messages" on messages;


create policy
  "Agents can read tenant data" on tenants for
select
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = tenants.id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read sites" on tenant_sites for
select
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = tenant_sites.tenant_id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read visitors" on visitors for
select
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = visitors.tenant_id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read conversations" on conversations for
select
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = conversations.tenant_id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can update conversations" on conversations for
update
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = conversations.tenant_id
        and agents.user_id = auth.uid ()
    )
  )
with
  check (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = conversations.tenant_id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can read messages" on messages for
select
  using (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = messages.tenant_id
        and agents.user_id = auth.uid ()
    )
  );


create policy
  "Agents can insert messages" on messages for insert
with
  check (
    exists (
      select
        1
      from
        agents
      where
        agents.tenant_id = messages.tenant_id
        and agents.user_id = auth.uid ()
    )
    and exists (
      select
        1
      from
        conversations
      where
        conversations.id = messages.conversation_id
        and conversations.tenant_id = messages.tenant_id
    )
  );


create policy
  "Visitors can read their visitor record" on visitors for
select
  using (visitors.anon_id = auth.uid ()::text);


create policy
  "Visitors can insert their visitor record" on visitors for insert
with
  check (visitors.anon_id = auth.uid ()::text);


create policy
  "Visitors can insert conversations" on conversations for insert
with
  check (
    exists (
      select
        1
      from
        visitors
      where
        visitors.id = conversations.visitor_id
        and visitors.anon_id = auth.uid ()::text
        and visitors.tenant_id = conversations.tenant_id
    )
  );


create policy
  "Visitors can read their conversations" on conversations for
select
  using (
    exists (
      select
        1
      from
        visitors
      where
        visitors.id = conversations.visitor_id
        and visitors.anon_id = auth.uid ()::text
        and visitors.tenant_id = conversations.tenant_id
    )
  );


create policy
  "Visitors can read their messages" on messages for
select
  using (
    exists (
      select
        1
      from
        conversations
        join visitors on visitors.id = conversations.visitor_id
      where
        conversations.id = messages.conversation_id
        and conversations.tenant_id = messages.tenant_id
        and visitors.anon_id = auth.uid ()::text
    )
  );


-- Removed create policy "Visitors can insert messages" to prevent visitors from
-- directly inserting messages using the public anon key. All visitor message
-- writes must go through server routes protected by verifyWidgetToken(), which
-- apply token validation, server-side rate limiting, and closed-conversation
-- enforcement. Keeping this policy would allow bypassing those protections.