-- Surgical patches to reduce egress - SQL functions
-- Run these in your Supabase SQL editor

-- Patch 1: Efficient conversations RPC (replaces heavy messages scan + joins)
-- Skips viewed NSFW messages when finding the last message for conversations
drop function if exists public.get_conversations(uuid);
create or replace function public.get_conversations(_user uuid)
returns table (
  peer_id uuid,
  peer_pseudo text,  -- P3 FIX: Include peer pseudo to avoid separate /users calls
  last_message_id uuid,
  last_created_at timestamptz,
  last_media_type text,
  last_media_url text,
  last_thumbnail_url text,
  last_is_nsfw boolean,
  last_sender_id uuid,
  last_receiver_id uuid,
  last_view_once boolean,
  last_caption text,
  last_seen boolean,  -- ADD: Include seen status for read receipts
  last_seen_at timestamptz,  -- ADD: Include seen timestamp
  unread_count int
)
language sql stable as $$
with msgs as (
  select
    case when sender_id = _user then receiver_id else sender_id end as peer_id,
    id,
    created_at,
    sender_id,
    receiver_id,
    media_type, media_url, thumbnail_url, is_nsfw, view_once, caption,
    seen,  -- ADD: Include seen status
    seen_at,  -- ADD: Include seen timestamp
    -- Skip NSFW messages that have been viewed (viewed_at is not null)
    -- This makes viewed NSFW messages "disappear" from conversation previews
    case when is_nsfw and viewed_at is not null then false else true end as should_show,
    row_number() over (
      partition by case when sender_id = _user then receiver_id else sender_id end
      order by 
        case when is_nsfw and viewed_at is not null then 1 else 0 end asc, -- Show non-viewed messages first
        created_at desc
    ) as rn
  from messages
  where sender_id = _user or receiver_id = _user
),
filtered_msgs as (
  select *
  from msgs
  where should_show = true and rn = 1 -- Get the latest non-viewed-NSFW message per conversation
),
unread as (
  select sender_id as peer_id, count(*)::int as unread_count
  from messages
  where receiver_id = _user and seen = false
    -- Don't count viewed NSFW messages as unread
    and not (is_nsfw = true and viewed_at is not null)
  group by sender_id
)
select
  m.peer_id,
  u.pseudo as peer_pseudo,  -- P3 FIX: Include peer pseudo from JOIN
  m.id as last_message_id,
  m.created_at as last_created_at,
  m.media_type as last_media_type,
  m.media_url as last_media_url,
  m.thumbnail_url as last_thumbnail_url,
  m.is_nsfw as last_is_nsfw,
  m.sender_id as last_sender_id,
  m.receiver_id as last_receiver_id,
  m.view_once as last_view_once,
  m.caption as last_caption,
  m.seen as last_seen,  -- ADD: Return seen status
  m.seen_at as last_seen_at,  -- ADD: Return seen timestamp
  coalesce(u2.unread_count, 0) as unread_count
from filtered_msgs m
left join users u on u.id = m.peer_id  -- P3 FIX: Join with users to get pseudo
left join unread u2 using (peer_id)     -- P3 FIX: Renamed to avoid conflict
order by m.created_at desc;
$$;

-- Patch 4: Batch read receipts (replaces per-message updates)
-- NOTE: This function is not currently used - read marking is handled by Edge Function
-- Keeping for reference but commented out to avoid function name conflicts
/*
create or replace function public.mark_read_up_to(_me uuid, _peer uuid, _before timestamptz)
returns void 
language sql 
security definer as $$
  update messages
  set seen = true, viewed_at = coalesce(viewed_at, now())
  where receiver_id = _me
    and sender_id = _peer
    and created_at <= _before
    and seen = false;
$$;
*/

-- Patch 8: Performance indexes (make light queries cheap)
create index if not exists idx_messages_pair_time on public.messages
  (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at desc);

create index if not exists idx_messages_receiver_seen_time on public.messages
  (receiver_id, seen, created_at desc);

-- Grant appropriate permissions
grant execute on function public.get_conversations to authenticated, anon;
-- grant execute on function public.mark_read_up_to to authenticated, anon; -- Commented out with function
