import { NextResponse } from 'next/server';
import { signWidgetToken } from '@/lib/widgetToken';
import { isOriginAllowed, buildCorsHeaders } from '@/lib/cors';

export async function OPTIONS(request: Request) {
  const originHeader = request.headers.get('origin');
  let tenantId: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    tenantId = searchParams.get('tenant');
  } catch {
    // ignore
  }

  if (!originHeader || !tenantId) {
    return new NextResponse(null, { status: 204 });
  }

  // Use the shared helper to decide if the origin is allowed
  const allowed = await isOriginAllowed(tenantId, originHeader);
  const headers = buildCorsHeaders(originHeader, allowed);
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant');
  const originHeader = request.headers.get('origin');

  if (!tenantId) {
    return NextResponse.json({ authorized: false, message: 'Missing tenant.' }, { status: 200 });
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

  const allowed = await isOriginAllowed(tenantId, originHeader);
  const corsHeaders = buildCorsHeaders(originHeader, allowed);

  if (!allowed) {
    return NextResponse.json(
      { authorized: false, message: 'Unauthorized domain.' },
      { headers: corsHeaders },
    );
  }

  const token = await signWidgetToken(tenantId, originHeader);

  return NextResponse.json({ authorized: true, message: '', token }, { headers: corsHeaders });
}
