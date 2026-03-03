import { getSupabaseServerClient } from './supabaseServer';

export function isAllowedDomain(hostname: string, allowedDomain: string) {
  if (!hostname || !allowedDomain) return false;
  if (hostname === allowedDomain) return true;
  return hostname.endsWith(`.${allowedDomain}`);
}

export function buildCorsHeaders(originHeader: string | null, allowed: boolean) {
  const headers = new Headers();
  if (originHeader && allowed) {
    headers.set('Access-Control-Allow-Origin', originHeader);
    headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

// Determine whether an origin is allowed for a tenant. Optionally accepts a
// supabase client for easier testing.
export async function isOriginAllowed(
  tenantId: string,
  originHeader: string,
  supabaseClient?: any,
): Promise<boolean> {
  if (!tenantId || !originHeader) return false;

  let hostname = '';
  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return false;
  }

  const supabase = supabaseClient ?? getSupabaseServerClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('tenant_sites')
    .select('allowed_domain')
    .eq('tenant_id', tenantId);

  if (error) return false;

  return (data ?? []).some((site: any) => isAllowedDomain(hostname, site.allowed_domain));
}
