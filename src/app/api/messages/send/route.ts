import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { verifyWidgetToken } from "@/lib/widgetToken";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_COUNT = 8;

interface SendMessagePayload {
  token: string;
  tenant_id: string;
  conversation_id: string;
  visitor_id: string;
  sender_type: "visitor";
  body: string;
}

export async function POST(request: Request) {
  let payload: SendMessagePayload | null = null;
  try {
    payload = (await request.json()) as SendMessagePayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  if (
    !payload?.token ||
    !payload.tenant_id ||
    !payload.conversation_id ||
    !payload.visitor_id ||
    !payload.body ||
    payload.sender_type !== "visitor"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid parameters." },
      { status: 400 }
    );
  }

  const widgetPayload = await verifyWidgetToken(payload.token);
  if (!widgetPayload || widgetPayload.tenantId !== payload.tenant_id) {
    return NextResponse.json(
      { error: "Invalid or expired token." },
      { status: 401 }
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server is missing Supabase service credentials." },
      { status: 500 }
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("id", payload.conversation_id)
    .eq("tenant_id", payload.tenant_id)
    .eq("visitor_id", payload.visitor_id)
    .maybeSingle();

  if (conversationError) {
    return NextResponse.json(
      { error: conversationError.message },
      { status: 500 }
    );
  }

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 403 }
    );
  }

  if (conversation.status === "closed") {
    return NextResponse.json(
      { error: "This conversation is closed. Start a new conversation." },
      { status: 409 }
    );
  }

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", payload.tenant_id)
    .eq("visitor_id", payload.visitor_id)
    .gte("created_at", windowStart);

  if (countError) {
    return NextResponse.json(
      { error: countError.message },
      { status: 500 }
    );
  }

  if ((count ?? 0) >= RATE_LIMIT_COUNT) {
    return NextResponse.json(
      { error: "Please wait a minute before sending more messages." },
      { status: 429 }
    );
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      tenant_id: payload.tenant_id,
      conversation_id: payload.conversation_id,
      sender_type: "visitor",
      body: payload.body.trim(),
    })
    .select("id, tenant_id, conversation_id, sender_type, body, created_at")
    .single();

  if (messageError) {
    return NextResponse.json(
      { error: messageError.message },
      { status: 500 }
    );
  }

  await supabase.from("rate_limit_log").insert({
    tenant_id: payload.tenant_id,
    visitor_id: payload.visitor_id,
  });

  await supabase
    .from("rate_limit_log")
    .delete()
    .eq("tenant_id", payload.tenant_id)
    .eq("visitor_id", payload.visitor_id)
    .lt("created_at", windowStart);

  return NextResponse.json({ data: message });
}
