-- Player search for the Friends page: suggestions after 3 letters.
--
-- Usernames are already public (rankings, profiles), so this reveals nothing
-- new. Names starting with the text come first, then names containing it;
-- at most 8 results, never yourself, each with how you stand with them.

create function public.search_players(p_user uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_pattern text;
begin
  if v_query !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_INPUT';
  end if;
  -- "_" is a wildcard in LIKE: match it literally.
  v_pattern := replace(v_query, '_', '\_');

  return coalesce((
    select jsonb_agg(row_data order by starts desc, name_length, lower_name)
    from (
      select
        lower(p.username) like v_pattern || '%' as starts,
        length(p.username) as name_length,
        lower(p.username) as lower_name,
        public.player_json(p.id) || jsonb_build_object(
          'status', case
            when f.status = 'accepted' then 'friends'
            when f.status = 'pending' and f.requester_id = p_user then 'outgoing'
            when f.status = 'pending' then 'incoming'
            else 'none'
          end
        ) as row_data
      from public.profiles p
      left join public.friendships f
        on least(f.requester_id, f.addressee_id) = least(p_user, p.id)
       and greatest(f.requester_id, f.addressee_id) = greatest(p_user, p.id)
      where p.id <> p_user
        and lower(p.username) like '%' || v_pattern || '%'
      order by starts desc, name_length, lower_name
      limit 8
    ) found
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.search_players(uuid, text) from public, anon, authenticated;
grant execute on function public.search_players(uuid, text) to service_role;
