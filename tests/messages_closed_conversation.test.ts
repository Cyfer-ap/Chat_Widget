import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const canRunIntegration = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!canRunIntegration) {
  test.skip('DB trigger prevents inserts into closed conversations (integration skipped - set SUPABASE_ env vars)', () => {});
} else {
  test('DB trigger blocks inserts into closed conversations and allows when open', async () => {
    const service = createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false },
    });

    // Setup: create tenant, visitor, conversation
    const tRes = await service
      .from('tenants')
      .insert({ name: 'test-tenant-closed' })
      .select()
      .throwOnError();
    const tenant = Array.isArray(tRes.data) ? tRes.data[0] : tRes.data;

    const vRes = await service
      .from('visitors')
      .insert({ tenant_id: tenant.id, anon_id: 'test-anon-closed' })
      .select()
      .throwOnError();
    const visitor = Array.isArray(vRes.data) ? vRes.data[0] : vRes.data;

    const cRes = await service
      .from('conversations')
      .insert({ tenant_id: tenant.id, visitor_id: visitor.id })
      .select()
      .throwOnError();
    const conversation = Array.isArray(cRes.data) ? cRes.data[0] : cRes.data;

    assert.equal(conversation.status, 'open');

    // Insert a message while open - should succeed
    const msgOpen = await service.from('messages').insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'agent',
      body: 'hello while open',
    });
    assert.ok(
      !msgOpen.error,
      `expected insert while open to succeed but got error: ${JSON.stringify(msgOpen.error)}`,
    );

    // Close the conversation
    const upd = await service
      .from('conversations')
      .update({ status: 'closed' })
      .eq('id', conversation.id)
      .select()
      .throwOnError();
    const convAfter = Array.isArray(upd.data) ? upd.data[0] : upd.data;
    assert.equal(convAfter.status, 'closed');

    // Attempt to insert a message - should fail due to trigger
    const msgClosed = await service.from('messages').insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'agent',
      body: 'hello while closed',
    });

    assert.ok(
      msgClosed.error,
      `expected insert into closed conversation to be rejected but it succeeded: ${JSON.stringify(msgClosed.data)}`,
    );

    // Cleanup
    await service.from('messages').delete().eq('conversation_id', conversation.id);
    await service.from('conversations').delete().eq('id', conversation.id);
    await service.from('visitors').delete().eq('id', visitor.id);
    await service.from('tenants').delete().eq('id', tenant.id);
  });
}
