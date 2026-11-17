-- Recent rooms for the Custom tab: your last 3 custom matches from rooms
-- (opponent and settings), so the same room can be set up again in one tap.

create function public.get_recent_rooms(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_data order by started_at desc), '[]'::jsonb)
  from (
    select
      r.started_at,
      jsonb_build_object(
        'opponent', public.player_json(case when r.host_id = p_user then r.guest_id else r.host_id end),
        'difficulty', r.difficulty,
        'duration_minutes', r.duration_minutes,
        'played_at', r.started_at
      ) as row_data
    from public.custom_rooms r
    where r.status = 'started'
      and (r.host_id = p_user or r.guest_id = p_user)
      and r.guest_id is not null
    order by r.started_at desc
    limit 3
  ) recent;
$$;

revoke execute on function public.get_recent_rooms(uuid) from public, anon, authenticated;
grant execute on function public.get_recent_rooms(uuid) to service_role;
