-- Public player profiles.
--
-- One function returns everything a profile page shows. It runs with elevated
-- rights so that anyone, even a visitor who is not logged in, can see a
-- player's public stats, but it only ever returns the fields listed here:
-- never an email address, never code, never problem titles or hidden tests.

create function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_rank bigint;
  v_battles jsonb;
  v_streak_result text;
  v_streak integer := 0;
  v_row record;
begin
  select * into v_profile from public.profiles where lower(username) = lower(p_username);
  if not found then
    return null;
  end if;

  select rank into v_rank
  from (select id, rank() over (order by rating desc) as rank from public.profiles) ranked
  where id = v_profile.id;

  -- Current streak: how many of the most recent results are the same.
  for v_row in
    select bp.result
    from public.battle_players bp
    join public.battles b on b.id = bp.battle_id
    where bp.user_id = v_profile.id and b.status = 'finished' and bp.result is not null
    order by b.finished_at desc
  loop
    if v_streak_result is null then
      v_streak_result := v_row.result;
    elsif v_row.result <> v_streak_result then
      exit;
    end if;
    v_streak := v_streak + 1;
  end loop;

  select coalesce(jsonb_agg(row_data order by finished_at desc), '[]'::jsonb) into v_battles
  from (
    select
      b.finished_at,
      jsonb_build_object(
        'battle_id', b.id,
        'result', bp.result,
        'rating_before', bp.rating_before,
        'rating_after', bp.rating_after,
        'opponent', (
          select p.username
          from public.battle_players other
          join public.profiles p on p.id = other.user_id
          where other.battle_id = b.id and other.user_id <> v_profile.id
        ),
        'finished_at', b.finished_at
      ) as row_data
    from public.battle_players bp
    join public.battles b on b.id = bp.battle_id
    where bp.user_id = v_profile.id and b.status = 'finished' and bp.rating_after is not null
    order by b.finished_at desc
    limit 10
  ) recent;

  return jsonb_build_object(
    'username', v_profile.username,
    'rating', v_profile.rating,
    'rank', v_rank,
    'member_since', v_profile.created_at,
    'wins', v_profile.wins,
    'losses', v_profile.losses,
    'draws', v_profile.draws,
    'peak_rating', greatest(
      v_profile.rating,
      1200,
      (
        select max(bp.rating_after)
        from public.battle_players bp
        join public.battles b on b.id = bp.battle_id
        where bp.user_id = v_profile.id and b.status = 'finished'
      )
    ),
    'streak', case
      when v_streak = 0 then null
      else jsonb_build_object('result', v_streak_result, 'count', v_streak)
    end,
    -- Rating after each finished battle, oldest first, starting from the
    -- rating before the first one.
    'rating_history', coalesce(
      (
        select jsonb_agg(value order by position)
        from (
          select 0 as position, first_battle.rating_before as value
          from (
            select bp.rating_before
            from public.battle_players bp
            join public.battles b on b.id = bp.battle_id
            where bp.user_id = v_profile.id and b.status = 'finished' and bp.rating_after is not null
            order by b.finished_at
            limit 1
          ) first_battle
          union all
          select
            row_number() over (order by b.finished_at) as position,
            bp.rating_after as value
          from public.battle_players bp
          join public.battles b on b.id = bp.battle_id
          where bp.user_id = v_profile.id and b.status = 'finished' and bp.rating_after is not null
        ) points
      ),
      '[]'::jsonb
    ),
    'languages', coalesce(
      (
        select jsonb_object_agg(language, battles)
        from (
          select bp.language, count(*)::int as battles
          from public.battle_players bp
          join public.battles b on b.id = bp.battle_id
          where bp.user_id = v_profile.id and b.status = 'finished' and bp.language is not null
          group by bp.language
        ) used
      ),
      '{}'::jsonb
    ),
    'wins_by_difficulty', (
      select jsonb_build_object(
        'easy', count(*) filter (where p.difficulty = 'easy'),
        'medium', count(*) filter (where p.difficulty = 'medium'),
        'hard', count(*) filter (where p.difficulty = 'hard')
      )
      from public.battle_players bp
      join public.battles b on b.id = bp.battle_id
      join public.problems p on p.id = b.problem_id
      where bp.user_id = v_profile.id and bp.result = 'win'
    ),
    'recent_battles', v_battles
  );
end;
$$;

revoke execute on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated, service_role;
