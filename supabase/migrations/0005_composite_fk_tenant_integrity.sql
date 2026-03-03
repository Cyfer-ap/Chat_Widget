-- Migration 0005: enforce tenant_id integrity with composite foreign keys.
--
-- Problem: conversations.tenant_id and messages.tenant_id were independent
-- columns. A malicious client could insert rows where tenant_id doesn't
-- match the linked visitor/conversation, causing cross-tenant data leakage.
--
-- Fix:
--   1. Add UNIQUE(id, tenant_id) on visitors and conversations so composite
--      FK references are possible.
--   2. Replace the simple FK on conversations.visitor_id with a composite FK
--      on (visitor_id, tenant_id) → visitors(id, tenant_id).
--   3. Replace the simple FK on messages.conversation_id with a composite FK
--      on (conversation_id, tenant_id) → conversations(id, tenant_id).
-- Step 1: composite unique constraints (required targets for composite FKs)
alter table
  visitors
add
  constraint visitors_id_tenant_id_key unique (id, tenant_id);


alter table
  conversations
add
  constraint conversations_id_tenant_id_key unique (id, tenant_id);


-- Step 2: conversations → visitors composite FK
alter table
  conversations
drop
  constraint if exists conversations_visitor_id_fkey;


alter table
  conversations
add
  constraint conversations_visitor_id_tenant_id_fkey foreign key (visitor_id, tenant_id) references visitors (id, tenant_id) on delete cascade;


-- Step 3: messages → conversations composite FK
alter table
  messages
drop
  constraint if exists messages_conversation_id_fkey;


alter table
  messages
add
  constraint messages_conversation_id_tenant_id_fkey foreign key (conversation_id, tenant_id) references conversations (id, tenant_id) on delete cascade;