import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const canRunIntegration = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

if (!canRunIntegration) {
  test.skip('anonymous insert into messages is rejected (integration test skipped - set SUPABASE_ env vars)', () => {});
} else {
  test('anonymous insert into messages is rejected by RLS', async () => {
    const service = createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false },
    });

    // Create tenant, visitor, conversation via service role
    const tRes = await service
      .from('tenants')
      .insert({ name: 'test-tenant' })
      .select()
      .throwOnError();
    const tenant = Array.isArray(tRes.data) ? tRes.data[0] : tRes.data;
    assert.ok(tenant && tenant.id, 'tenant created');

    const vRes = await service
      .from('visitors')
      .insert({ tenant_id: tenant.id, anon_id: 'test-anon-uid' })
      .select()
      .throwOnError();
    const visitor = Array.isArray(vRes.data) ? vRes.data[0] : vRes.data;
    assert.ok(visitor && visitor.id, 'visitor created');

    const cRes = await service
      .from('conversations')
      .insert({ tenant_id: tenant.id, visitor_id: visitor.id })
      .select()
      .throwOnError();
    const conversation = Array.isArray(cRes.data) ? cRes.data[0] : cRes.data;
    assert.ok(conversation && conversation.id, 'conversation created');

    // Use anon client to attempt to insert a message
    const anon = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: false },
    });

    // Attempt insert - this should be rejected by RLS now that visitor insert policy was removed.
    const insertRes = await anon.from('messages').insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'visitor',
      body: 'malicious anonymous message',
    });

    // The insert should not succeed. Assert that an error is returned.
    // supabase-js v2 returns { data, error }
    assert.ok(
      insertRes.error,
      `Expected insert to be rejected by RLS but it succeeded: ${JSON.stringify(insertRes.data)}`,
    );

    // Cleanup created rows via service role
    await service.from('messages').delete().eq('conversation_id', conversation.id);
    await service.from('conversations').delete().eq('id', conversation.id);
    await service.from('visitors').delete().eq('id', visitor.id);
    await service.from('tenants').delete().eq('id', tenant.id);
  });
}
