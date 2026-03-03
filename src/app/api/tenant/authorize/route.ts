import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { signWidgetToken } from '@/lib/widgetToken';

function isAllowedDomain(hostname: string, allowedDomain: string) {
  if (!hostname || !allowedDomain) return false;
  if (hostname === allowedDomain) return true;
  return hostname.endsWith(`.${allowedDomain}`);
}

function buildCorsHeaders(originHeader: string | null, allowed: boolean) {
  const headers = new Headers();
  // Only set CORS headers if the origin is allowed for the tenant.
  if (originHeader && allowed) {
    headers.set('Access-Control-Allow-Origin', originHeader);
    headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

export async function OPTIONS(request: Request) {
  const originHeader = request.headers.get('origin');
  // Try to determine tenant from query so we can validate the origin against the allowlist
  let tenantId: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    tenantId = searchParams.get('tenant');
  } catch {
    // ignore
  }

  if (!originHeader || !tenantId) {
    // If we don't have enough information to validate the origin, don't send CORS headers.
    return new NextResponse(null, { status: 204 });
  }

  // Validate origin against tenant allowlist
  let hostname = '';
  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return new NextResponse(null, { status: 500 });
  }

  const { data, error } = await supabase
    .from('tenant_sites')
    .select('allowed_domain')
    .eq('tenant_id', tenantId);

  if (error) {
    return new NextResponse(null, { status: 204 });
  }

  const allowed = (data ?? []).some((site) => isAllowedDomain(hostname, site.allowed_domain));
  const headers = buildCorsHeaders(originHeader, allowed);
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant');
  const originHeader = request.headers.get('origin');

  // If missing required params, return unauthorized but don't reveal CORS approval.
  if (!tenantId) {
    return NextResponse.json(
      { authorized: false, message: 'Missing tenant.' },
      { status: 200 },
    );
  }

  if (!originHeader) {
    return NextResponse.json(
      {
        authorized: false,
        message: 'Missing Origin header. The widget must be embedded in a page.',
      },
      { status: 200 },
    );
  }

  let hostname = '';
  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return NextResponse.json(
      { authorized: false, message: 'Invalid Origin header.' },
      { status: 200 },
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        authorized: false,
        message: 'Server is missing Supabase service credentials.',
      },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from('tenant_sites')
    .select('allowed_domain')
    .eq('tenant_id', tenantId);

  if (error) {
    return NextResponse.json(
      { authorized: false, message: error.message },
      { status: 500 },
    );
  }

  const allowed = (data ?? []).some((site) => isAllowedDomain(hostname, site.allowed_domain));

  const corsHeaders = buildCorsHeaders(originHeader, allowed);

  if (!allowed) {
    return NextResponse.json(
      { authorized: false, message: 'Unauthorized domain.' },
      { headers: corsHeaders },
    );
  }

  const token = await signWidgetToken(tenantId, originHeader);

  return NextResponse.json(
    { authorized: true, message: '', token },
    { headers: corsHeaders },
  );
}
