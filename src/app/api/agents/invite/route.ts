import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { verifyAgentForTenant } from '@/lib/tenantAuth';
import { auditLog, info } from '@/lib/logger';

interface InvitePayload {
  tenant_id: string;
  email: string;
  role?: string;
}

export async function POST(request: Request) {
  let payload: InvitePayload | null = null;
  try {
    payload = (await request.json()) as InvitePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const tenantId = payload?.tenant_id?.trim();
  const email = payload?.email?.trim().toLowerCase();
  const role = payload?.role?.trim() || 'agent';

  if (!tenantId || !email) {
    return NextResponse.json({ error: 'Missing tenant_id or email.' }, { status: 400 });
  }

  const agentCheck = await verifyAgentForTenant(request, tenantId, true);
  if (agentCheck instanceof NextResponse) return agentCheck;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server is missing Supabase service credentials.' },
      { status: 500 },
    );
  }

  const token = randomUUID();
  const { error: inviteError } = await supabase.from('agent_invites').insert({
    token,
    tenant_id: tenantId,
    email,
    role,
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  const origin = request.headers.get('origin');
  const inviteUrl = origin ? `${origin}/invite?token=${token}` : null;

  // Audit log
  await auditLog(tenantId, agentCheck.userId, 'agent_invite.create', {
    email,
    role,
    invite_url: inviteUrl,
  });
  info('Agent invite created', { tenantId, email, role });

  return NextResponse.json({ token, invite_url: inviteUrl, role, email });
}
