import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

interface AcceptInvitePayload {
  token: string;
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization') ?? '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing access token.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server is missing Supabase service credentials.' },
      { status: 500 },
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'Invalid access token.' }, { status: 401 });
  }

  let payload: AcceptInvitePayload | null = null;
  try {
    payload = (await request.json()) as AcceptInvitePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const token = payload?.token?.trim();
  if (!token) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  }

  const { data: invite, error: inviteError } = await supabase
    .from('agent_invites')
    .select('token, tenant_id, email, role, used_at')
    .eq('token', token)
    .maybeSingle();

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  if (!invite || invite.used_at) {
    return NextResponse.json({ error: 'Invite is invalid or used.' }, { status: 404 });
  }

  const userEmail = userData.user.email?.toLowerCase() ?? '';
  if (invite.email && userEmail !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Invite email does not match the current user.' },
      { status: 403 },
    );
  }

  const { data: existingAgent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .eq('tenant_id', invite.tenant_id)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 500 });
  }

  if (existingAgent) {
    return NextResponse.json(
      { error: 'User is already an agent for this tenant.' },
      { status: 409 },
    );
  }

  const { error: insertError } = await supabase.from('agents').insert({
    tenant_id: invite.tenant_id,
    user_id: userData.user.id,
    role: invite.role ?? 'agent',
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('agent_invites')
    .update({ used_at: new Date().toISOString(), used_by: userData.user.id })
    .eq('token', token);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ tenant_id: invite.tenant_id, role: invite.role });
}
