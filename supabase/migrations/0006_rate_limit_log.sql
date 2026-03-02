-- Migration 0006: server-side rate limiting table for visitor messages.
--
-- Each row records one message send attempt from a visitor within a tenant.
-- The API route counts rows in the last N seconds and rejects when over limit.
-- Old rows are pruned on every successful insert to keep the table small.

create table if not exists rate_limit_log (
  id          bigserial primary key,
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  visitor_id  uuid        not null references visitors(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_rate_limit_log_lookup
  on rate_limit_log (tenant_id, visitor_id, created_at desc);

