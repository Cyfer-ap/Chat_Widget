import { NextRequest, NextResponse } from "next/server";
import { buildFrameAncestorsCsp } from "@/lib/csp";
import { verifyWidgetToken } from "@/lib/widgetToken";

export async function middleware(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  let csp = "frame-ancestors 'none';";
  if (token) {
    const payload = await verifyWidgetToken(token);
    if (payload?.origin) {
      csp = buildFrameAncestorsCsp([payload.origin]);
    }
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/widget"],
};

