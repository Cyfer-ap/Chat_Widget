alter table conversations
  add column if not exists last_message_at timestamptz not null default now();

update conversations
  set last_message_at = created_at
  where last_message_at is null;

create or replace function update_conversation_last_message_at()
returns trigger as $$
begin
  update conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists messages_set_last_message_at on messages;
create trigger messages_set_last_message_at
  after insert on messages
  for each row
  execute function update_conversation_last_message_at();

