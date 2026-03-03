-- Migration 0007: bootstrap guard + agent invite tokens.
create table if not exists
  bootstrap_log (
    id bigserial primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    user_id uuid not null,
    used_at timestamptz not null default now()
  );


create unique index if not exists idx_bootstrap_singleton on bootstrap_log ((1));


create table if not exists
  agent_invites (
    token text primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    email text not null,
    role text not null default 'agent',
    created_at timestamptz not null default now(),
    used_at timestamptz,
    used_by uuid
  );


create index
  if not exists idx_agent_invites_tenant_id on agent_invites (tenant_id, created_at desc);