import { getSupabaseServerClient } from './supabaseServer';

export async function auditLog(
  tenantId: string | null,
  actor: string | null,
  action: string,
  details: any,
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  try {
    await supabase.from('audit_logs').insert({ tenant_id: tenantId, actor, action, details });
  } catch (err) {
    // best-effort logging; don't break the caller
    // eslint-disable-next-line no-console
    console.warn('auditLog failed', err);
  }
}

export function info(message: string, meta?: any) {
  // Minimal console logger for now; can be replaced with a real monitoring integration
  // eslint-disable-next-line no-console
  console.info(message, meta ?? '');
}

export function error(message: string, meta?: any) {
  // eslint-disable-next-line no-console
  console.error(message, meta ?? '');
}
