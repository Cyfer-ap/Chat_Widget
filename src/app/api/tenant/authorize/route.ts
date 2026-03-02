import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { signWidgetToken } from "@/lib/widgetToken";

function isAllowedDomain(hostname: string, allowedDomain: string) {
  if (!hostname || !allowedDomain) return false;
  if (hostname === allowedDomain) return true;
  return hostname.endsWith(`.${allowedDomain}`);
}

function buildCorsHeaders(originHeader: string | null) {
  const headers = new Headers();
  if (originHeader) {
    headers.set("Access-Control-Allow-Origin", originHeader);
    headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
  }
  return headers;
}

export async function OPTIONS(request: Request) {
  const originHeader = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(originHeader),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenant");
  const originHeader = request.headers.get("origin");
  const corsHeaders = buildCorsHeaders(originHeader);

  if (!tenantId) {
    return NextResponse.json(
      { authorized: false, message: "Missing tenant." },
      { headers: corsHeaders }
    );
  }

  if (!originHeader) {
    return NextResponse.json(
      {
        authorized: false,
        message: "Missing Origin header. The widget must be embedded in a page.",
      },
      { headers: corsHeaders }
    );
  }

  let hostname = "";
  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return NextResponse.json(
      { authorized: false, message: "Invalid Origin header." },
      { headers: corsHeaders }
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        authorized: false,
        message: "Server is missing Supabase service credentials.",
      },
      { headers: corsHeaders }
    );
  }

  const { data, error } = await supabase
    .from("tenant_sites")
    .select("allowed_domain")
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json(
      { authorized: false, message: error.message },
      { headers: corsHeaders }
    );
  }

  const allowed = (data ?? []).some((site) =>
    isAllowedDomain(hostname, site.allowed_domain)
  );

  if (!allowed) {
    return NextResponse.json(
      { authorized: false, message: "Unauthorized domain." },
      { headers: corsHeaders }
    );
  }

  const token = await signWidgetToken(tenantId, originHeader);

  return NextResponse.json(
    { authorized: true, message: "", token },
    { headers: corsHeaders }
  );
}
