-- Public numbers for the landing page ("lobby"): how many players exist and
-- how many battles started today (UTC). Counts only: no names, emails or ids.
create function public.get_lobby_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'battles_today', (
      select count(*) from public.battles
      where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    )
  );
$$;

revoke all on function public.get_lobby_stats() from public;
grant execute on function public.get_lobby_stats() to anon, authenticated;
