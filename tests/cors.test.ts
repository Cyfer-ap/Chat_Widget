import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, buildCorsHeaders } from '../src/lib/cors';

// Mock supabase client that returns allowlist rows
function makeMockClient(rows: any[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          // return a resolved Promise-like object matching supabase-js shape
          then: (cb: any) => cb({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

test('isOriginAllowed returns true for exact domain', async () => {
  const mock = makeMockClient([{ allowed_domain: 'example.com' }]);
  const allowed = await isOriginAllowed('tenant-1', 'https://example.com', mock as any);
  assert.equal(allowed, true);
});

test('isOriginAllowed returns true for subdomain', async () => {
  const mock = makeMockClient([{ allowed_domain: 'example.com' }]);
  const allowed = await isOriginAllowed('tenant-1', 'https://sub.example.com', mock as any);
  assert.equal(allowed, true);
});

test('isOriginAllowed rejects invalid origin', async () => {
  const mock = makeMockClient([{ allowed_domain: 'example.com' }]);
  const allowed = await isOriginAllowed('tenant-1', 'not-a-url', mock as any);
  assert.equal(allowed, false);
});

test('buildCorsHeaders only sets ACAO when allowed', () => {
  const headersAllowed = buildCorsHeaders('https://example.com', true);
  assert.equal(headersAllowed.get('Access-Control-Allow-Origin'), 'https://example.com');

  const headersDenied = buildCorsHeaders('https://evil.com', false);
  assert.equal(headersDenied.get('Access-Control-Allow-Origin'), null);
});
