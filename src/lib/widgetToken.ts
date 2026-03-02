const TOKEN_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf8").toString("base64url");
  }
  const base64 = btoa(input);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  return atob(padded);
}

function getSecret(): string {
  const secret = process.env.WIDGET_TOKEN_SECRET;
  if (!secret) throw new Error("Missing WIDGET_TOKEN_SECRET env variable.");
  return secret;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export interface WidgetTokenPayload {
  tenantId: string;
  origin: string;
  exp: number;
}

export async function signWidgetToken(
  tenantId: string,
  origin: string
): Promise<string> {
  const payload: WidgetTokenPayload = {
    tenantId,
    origin,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmac(getSecret(), body);
  return `${body}.${sig}`;
}

export async function verifyWidgetToken(
  token: string
): Promise<WidgetTokenPayload | null> {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;

    const expected = await hmac(getSecret(), body);
    if (expected.length !== sig.length) return null;

    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    if (diff !== 0) return null;

    const payload = JSON.parse(base64UrlDecode(body)) as WidgetTokenPayload;

    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}
