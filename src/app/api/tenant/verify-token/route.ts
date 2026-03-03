import { NextResponse } from 'next/server';
import { verifyWidgetToken } from '@/lib/widgetToken';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const tenant = searchParams.get('tenant');

  if (!token || !tenant) {
    return NextResponse.json({ valid: false, message: 'Missing parameters.' });
  }

  const payload = await verifyWidgetToken(token);
  if (!payload) {
    return NextResponse.json({ valid: false, message: 'Invalid or expired token.' });
  }

  if (payload.tenantId !== tenant) {
    return NextResponse.json({ valid: false, message: 'Token tenant mismatch.' });
  }

  return NextResponse.json({ valid: true });
}
