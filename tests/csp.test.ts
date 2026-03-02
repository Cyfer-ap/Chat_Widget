import test from "node:test";
import assert from "node:assert/strict";
import { buildFrameAncestorsCsp } from "../src/lib/csp";

test("builds frame-ancestors with valid origins", () => {
  const csp = buildFrameAncestorsCsp(["https://example.com"]);
  assert.equal(csp, "frame-ancestors https://example.com;");
});

test("falls back to none when origins are invalid", () => {
  const csp = buildFrameAncestorsCsp(["not-a-url"]);
  assert.equal(csp, "frame-ancestors 'none';");
});

