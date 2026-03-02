import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function isAllowedDomain(hostname: string, allowedDomain: string) {
  if (!hostname || !allowedDomain) return false;
  if (hostname === allowedDomain) return true;
  return hostname.endsWith(`.${allowedDomain}`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenant");
  const referrer = searchParams.get("referrer") ?? request.headers.get("referer");
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!tenantId) {
    return NextResponse.json({ authorized: false, message: "Missing tenant." });
  }

  let hostname = "";
  try {
    if (referrer) {
      hostname = new URL(referrer).hostname;
    } else if (origin) {
      hostname = new URL(origin).hostname;
    } else if (host) {
      hostname = host.split(":")[0];
    } else {
      return NextResponse.json({
        authorized: false,
        message: "Missing referrer.",
      });
    }
  } catch {
    return NextResponse.json({
      authorized: false,
      message: "Invalid referrer.",
    });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({
      authorized: false,
      message: "Server is missing Supabase service credentials.",
    });
  }

  const { data, error } = await supabase
    .from("tenant_sites")
    .select("allowed_domain")
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({
      authorized: false,
      message: error.message,
    });
  }

  const allowed = (data ?? []).some((site) =>
    isAllowedDomain(hostname, site.allowed_domain)
  );

  return NextResponse.json({
    authorized: allowed,
    message: allowed ? "" : "Unauthorized domain.",
  });
}
