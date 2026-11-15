-- Avatars: every player shows one of six built-in avatars instead of a letter.
--
-- Players choose from a fixed list, so there are no uploads to store or
-- moderate. Existing and new players get one assigned automatically, picked
-- from their account id so it is stable but varied. Only the Worker can change
-- it, through set_avatar, like every other write.

alter table public.profiles
  add column avatar text not null default 'cipher'
  check (avatar in ('cipher', 'kernel', 'vector', 'nova', 'pixel', 'echo'));

-- A stable starting avatar for an account.
create function public.default_avatar(p_user uuid)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select (array['cipher', 'kernel', 'vector', 'nova', 'pixel', 'echo'])[
    1 + mod(abs(hashtext(p_user::text)::bigint), 6)
  ];
$$;

update public.profiles set avatar = public.default_avatar(id);

-- Sign-up: take the avatar from sign-up data when it is valid, otherwise assign one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
  v_avatar text := new.raw_user_meta_data ->> 'avatar';
begin
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    raise exception 'USERNAME_TAKEN';
  end if;
  if v_avatar is null or v_avatar not in ('cipher', 'kernel', 'vector', 'nova', 'pixel', 'echo') then
    v_avatar := public.default_avatar(new.id);
  end if;
  insert into public.profiles (id, username, avatar) values (new.id, v_username, v_avatar);
  return new;
end;
$$;

create function public.set_avatar(p_user uuid, p_avatar text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_avatar is null or p_avatar not in ('cipher', 'kernel', 'vector', 'nova', 'pixel', 'echo') then
    raise exception 'INVALID_INPUT';
  end if;
  update public.profiles set avatar = p_avatar where id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return p_avatar;
end;
$$;

revoke execute on function public.default_avatar(uuid) from public, anon, authenticated;
revoke execute on function public.set_avatar(uuid, text) from public, anon, authenticated;
grant execute on function public.default_avatar(uuid) to service_role;
grant execute on function public.set_avatar(uuid, text) to service_role;

create or replace view public.leaderboard
with (security_invoker = true) as
select
  p.id,
  p.username,
  p.rating,
  p.wins,
  p.losses,
  p.draws,
  rank() over (order by p.rating desc) as rank,
  p.avatar
from public.profiles p;

-- Battle state and public profiles now include avatars (bodies otherwise unchanged).
create or replace function public.get_battle_state(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_problem public.problems;
begin
  if not exists (select 1 from public.battles where id = p_battle) then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  perform public.finalize_battle_if_expired(p_battle);

  select * into v_battle from public.battles where id = p_battle;
  select * into v_problem from public.problems where id = v_battle.problem_id;

  return jsonb_build_object(
    'server_time', now(),
    'battle', jsonb_build_object(
      'id', v_battle.id,
      'status', v_battle.status,
      'starts_at', v_battle.starts_at,
      'ends_at', v_battle.ends_at,
      'finished_at', v_battle.finished_at,
      'winner_id', v_battle.winner_id,
      'finish_reason', v_battle.finish_reason
    ),
    'players', (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', bp.user_id,
          'username', p.username,
          'avatar', p.avatar,
          'is_you', bp.user_id = p_user,
          'language', bp.language,
          'attempts', bp.attempts,
          'best_passed', bp.best_passed,
          'rating_before', bp.rating_before,
          'rating_after', bp.rating_after,
          'result', bp.result
        )
        order by (bp.user_id = p_user) desc
      )
      from public.battle_players bp
      join public.profiles p on p.id = bp.user_id
      where bp.battle_id = p_battle
    ),
    'total_tests', (
      select count(*) from public.problem_tests where problem_id = v_battle.problem_id
    ),
    'problem', case
      when now() >= v_battle.starts_at then jsonb_build_object(
        'title', v_problem.title,
        'difficulty', v_problem.difficulty,
        'statement_md', v_problem.statement_md,
        'samples', v_problem.samples,
        'time_limit_ms', v_problem.time_limit_ms,
        'memory_limit_kb', v_problem.memory_limit_kb
      )
      else null
    end
  );
end;
$$;

create or replace function public.get_public_profile(p_username text)
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
        'opponent_avatar', (
          select p.avatar
          from public.battle_players other
          join public.profiles p on p.id = other.user_id
          where other.battle_id = b.id and other.user_id <> v_profile.id
        ),
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
    'avatar', v_profile.avatar,
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
