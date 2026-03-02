create or replace function reopen_conversation_on_visitor_message()
returns trigger as $$
begin
  if new.sender_type = 'visitor' then
    update conversations
      set status = 'open'
      where id = new.conversation_id
        and status <> 'open';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists messages_reopen_conversation on messages;
create trigger messages_reopen_conversation
  after insert on messages
  for each row
  execute function reopen_conversation_on_visitor_message();

