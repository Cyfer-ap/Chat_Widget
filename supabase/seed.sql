insert into
  tenants (id, name)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'Demo Tenant'
  ) on conflict
do
  nothing;


insert into
  tenant_sites (tenant_id, allowed_domain)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'localhost'
  ) on conflict
do
  nothing;