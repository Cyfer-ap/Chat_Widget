import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

interface BootstrapPayload {
  tenant_name: string;
  allowed_domain?: string;
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function POST(request: Request) {
  const secret = process.env.BOOTSTRAP_ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Missing BOOTSTRAP_ADMIN_SECRET." },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get("x-bootstrap-secret");
  if (!providedSecret || providedSecret !== secret) {
    return NextResponse.json({ error: "Invalid bootstrap secret." }, { status: 401 });
  }

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

  let payload: BootstrapPayload | null = null;
  try {
    payload = (await request.json()) as BootstrapPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const tenantName = payload?.tenant_name?.trim();
  const allowedDomain = payload?.allowed_domain?.trim();
  if (!tenantName) {
    return NextResponse.json(
      { error: "Missing tenant_name." },
      { status: 400 }
    );
  }

  const { data: existingBootstrap, error: bootstrapError } = await supabase
    .from("bootstrap_log")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (bootstrapError) {
    return NextResponse.json(
      { error: bootstrapError.message },
      { status: 500 }
    );
  }

  if (existingBootstrap) {
    return NextResponse.json(
      { error: "Bootstrap already completed." },
      { status: 409 }
    );
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: tenantName })
    .select("id, name, created_at")
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json(
      { error: tenantError?.message ?? "Unable to create tenant." },
      { status: 500 }
    );
  }

  if (allowedDomain) {
    const { error: siteError } = await supabase.from("tenant_sites").insert({
      tenant_id: tenant.id,
      allowed_domain: allowedDomain,
    });

    if (siteError) {
      return NextResponse.json({ error: siteError.message }, { status: 500 });
    }
  }

  const { error: agentError } = await supabase.from("agents").insert({
    tenant_id: tenant.id,
    user_id: userData.user.id,
    role: "admin",
  });

  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 500 });
  }

  const { error: logError } = await supabase.from("bootstrap_log").insert({
    tenant_id: tenant.id,
    user_id: userData.user.id,
  });

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  return NextResponse.json({ tenant, role: "admin" });
}

