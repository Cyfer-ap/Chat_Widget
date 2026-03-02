const TOKEN_TTL_MS = 5 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.WIDGET_TOKEN_SECRET;
  if (!secret) throw new Error("Missing WIDGET_TOKEN_SECRET env variable.");
  return secret;
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
  return Buffer.from(signature).toString("base64url");
}

export interface WidgetTokenPayload {
  tenantId: string;
  hostname: string;
  exp: number;
}

export async function signWidgetToken(
  tenantId: string,
  hostname: string
): Promise<string> {
  const payload: WidgetTokenPayload = {
    tenantId,
    hostname,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
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

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as WidgetTokenPayload;

    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

