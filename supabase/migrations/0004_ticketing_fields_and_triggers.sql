alter table
  conversations
add column if not exists
  subject text,
add column if not exists
  resolved_at timestamptz,
add column if not exists
  last_activity_at timestamptz not null default now();


update
  conversations
set
  last_activity_at = coalesce(last_message_at, created_at)
where
  last_activity_at is null;


create
or replace function update_conversation_last_activity () returns trigger as $$
begin
  update conversations
    set last_message_at = new.created_at,
        last_activity_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;


drop trigger
  if exists messages_set_last_message_at on messages;


create trigger
  messages_set_last_message_at
after
  insert on messages for each row
execute
  function update_conversation_last_activity ();


create
or replace function set_conversation_resolved_at () returns trigger as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at = now();
  elsif new.status = 'open' then
    new.resolved_at = null;
  end if;
  return new;
end;
$$ language plpgsql;


drop trigger
  if exists conversations_set_resolved_at on conversations;


create trigger
  conversations_set_resolved_at before
update
  on conversations for each row
execute
  function set_conversation_resolved_at ();


create
or replace function reopen_conversation_on_visitor_message () returns trigger as $$
begin
  if new.sender_type = 'visitor' then
    update conversations
      set status = 'open',
          resolved_at = null
      where id = new.conversation_id
        and status in ('resolved', 'pending');
  end if;
  return new;
end;
$$ language plpgsql;


drop trigger
  if exists messages_reopen_conversation on messages;


create trigger
  messages_reopen_conversation
after
  insert on messages for each row
execute
  function reopen_conversation_on_visitor_message ();