-- db/functions/fn_mark_messages_read_by_pair.sql
-- idempotent: re-run safe
create or replace function public.fn_mark_messages_read_by_pair(
  p_receiver_id uuid,
  p_sender_id uuid,
  p_before timestamptz
) returns table (updated_id uuid) as $$
  update public.messages m
     set seen = true,
         seen_at = now()
   where m.receiver_id = p_receiver_id
     and m.sender_id   = p_sender_id
     and m.created_at <= p_before
     and coalesce(m.seen,false) = false
  returning m.id;
$$ language sql security definer;

-- index useful for performance on unseen messages by pair
create index if not exists idx_messages_receiver_sender_created_on_unseen
  on public.messages (receiver_id, sender_id, created_at desc)
  where coalesce(seen,false) = false;
