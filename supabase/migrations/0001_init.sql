create table if not exists
  tenants (
    id uuid primary key default gen_random_uuid (),
    name text not null,
    created_at timestamptz not null default now()
  );


create table if not exists
  tenant_sites (
    id uuid primary key default gen_random_uuid (),
    tenant_id uuid not null references tenants (id) on delete cascade,
    allowed_domain text not null,
    created_at timestamptz not null default now()
  );


create table if not exists
  agents (
    id uuid primary key default gen_random_uuid (),
    tenant_id uuid not null references tenants (id) on delete cascade,
    user_id uuid not null,
    role text not null default 'agent',
    created_at timestamptz not null default now()
  );


create table if not exists
  visitors (
    id uuid primary key default gen_random_uuid (),
    tenant_id uuid not null references tenants (id) on delete cascade,
    anon_id text not null,
    last_seen timestamptz not null default now(),
    created_at timestamptz not null default now()
  );


create table if not exists
  conversations (
    id uuid primary key default gen_random_uuid (),
    tenant_id uuid not null references tenants (id) on delete cascade,
    visitor_id uuid not null references visitors (id) on delete cascade,
    status text not null default 'open',
    created_at timestamptz not null default now()
  );


create table if not exists
  messages (
    id uuid primary key default gen_random_uuid (),
    tenant_id uuid not null references tenants (id) on delete cascade,
    conversation_id uuid not null references conversations (id) on delete cascade,
    sender_type text not null,
    body text not null,
    created_at timestamptz not null default now()
  );


create index
  if not exists idx_tenant_sites_tenant_id on tenant_sites (tenant_id);


create index
  if not exists idx_agents_tenant_id on agents (tenant_id);


create index
  if not exists idx_visitors_tenant_id on visitors (tenant_id);


create index
  if not exists idx_conversations_tenant_id on conversations (tenant_id);


create index
  if not exists idx_messages_conversation_id on messages (conversation_id);