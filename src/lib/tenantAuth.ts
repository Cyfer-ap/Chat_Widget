import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "./supabaseServer";

interface AgentCheckResult {
  userId: string;
  role: string;
}

export async function verifyAgentForTenant(
  request: Request,
  tenantId: string,
  requireAdmin = false
): Promise<AgentCheckResult | NextResponse> {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return NextResponse.json({ error: "Missing access token." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server is missing Supabase service credentials." },
      { status: 500 }
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Invalid access token." }, { status: 401 });
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

  if (!agentRow) {
    return NextResponse.json({ error: "Agent access required." }, { status: 403 });
  }

  if (requireAdmin && agentRow.role !== "admin") {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }

  return { userId: userData.user.id, role: agentRow.role };
}

