import test from "node:test";
import assert from "node:assert/strict";
import { signWidgetToken, verifyWidgetToken } from "../src/lib/widgetToken";

process.env.WIDGET_TOKEN_SECRET = "test-secret";

test("signs and verifies widget tokens", async () => {
  const token = await signWidgetToken("tenant-1", "https://example.com");
  const payload = await verifyWidgetToken(token);

  assert.ok(payload);
  assert.equal(payload.tenantId, "tenant-1");
  assert.equal(payload.origin, "https://example.com");
  assert.ok(payload.exp > Date.now());
});

test("rejects tampered tokens", async () => {
  const token = await signWidgetToken("tenant-1", "https://example.com");
  const [body, sig] = token.split(".");

  assert.ok(body && sig);
  const tampered = `${body.slice(0, -1)}A.${sig}`;
  const payload = await verifyWidgetToken(tampered);

  assert.equal(payload, null);
});

