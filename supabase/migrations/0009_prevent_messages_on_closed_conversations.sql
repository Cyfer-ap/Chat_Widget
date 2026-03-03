-- Migration 0009: Prevent inserting messages into conversations with status = 'closed'
-- This adds a BEFORE INSERT trigger on messages that checks the referenced
-- conversation's status and raises an exception if it's 'closed'. This enforces
-- "closed means closed" at the DB level for any client (agents, service role,
-- etc.).
create
or replace function prevent_messages_on_closed_conversation () returns trigger as $$
declare
  conv_status text;
begin
  select status into conv_status
    from conversations
    where id = new.conversation_id
      and tenant_id = new.tenant_id;

  if conv_status is null then
    -- If the conversation doesn't exist, let the FK constraint or caller handle it.
    raise exception 'conversation not found';
  end if;

  if conv_status = 'closed' then
    raise exception 'cannot insert messages into closed conversation';
  end if;

  return new;
end;
$$ language plpgsql;


-- Ensure we don't create duplicate triggers when re-running migrations
drop trigger
  if exists prevent_messages_on_closed_conversation on messages;


create trigger
  prevent_messages_on_closed_conversation before insert on messages for each row
execute
  function prevent_messages_on_closed_conversation ();