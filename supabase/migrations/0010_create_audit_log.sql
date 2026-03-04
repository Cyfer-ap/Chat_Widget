-- Migration 0010: create audit_logs table for recording important admin actions
create table if not exists
  audit_logs (
    id bigserial primary key,
    tenant_id uuid,
    actor text,
    action text not null,
    details jsonb,
    created_at timestamptz not null default now()
  );


create index
  if not exists idx_audit_logs_tenant_id on audit_logs (tenant_id, created_at desc);