import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

interface InvitePayload {
  tenant_id: string;
  email: string;
  role?: string;
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: "Missing access token." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server is missing Supabase service credentials." },
      { status: 500 }
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(
    accessToken
  );
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Invalid access token." }, { status: 401 });
  }

  let payload: InvitePayload | null = null;
  try {
    payload = (await request.json()) as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const tenantId = payload?.tenant_id?.trim();
  const email = payload?.email?.trim().toLowerCase();
  const role = payload?.role?.trim() || "agent";

  if (!tenantId || !email) {
    return NextResponse.json(
      { error: "Missing tenant_id or email." },
      { status: 400 }
    );
  }

  const { data: agentRow, error: agentError } = await supabase
    .from("agents")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 500 });
  }

  if (!agentRow || agentRow.role !== "admin") {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }

  const token = randomUUID();
  const { error: inviteError } = await supabase.from("agent_invites").insert({
    token,
    tenant_id: tenantId,
    email,
    role,
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  const origin = request.headers.get("origin");
  const inviteUrl = origin ? `${origin}/invite?token=${token}` : null;

  return NextResponse.json({ token, invite_url: inviteUrl, role, email });
}

