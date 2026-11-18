-- Blitz mode (approved 2026-11-18): 5-minute battles on Easy problems, with
-- their own matchmaking queue and their own rating (starting at 1200) and
-- record. Ranked ratings, records and profile stats are untouched by Blitz.
-- Blitz overtime is 1 minute and Blitz submits wait 5 seconds.

alter table public.profiles
  add column blitz_rating integer not null default 1200,
  add column blitz_wins integer not null default 0 check (blitz_wins >= 0),
  add column blitz_losses integer not null default 0 check (blitz_losses >= 0),
  add column blitz_draws integer not null default 0 check (blitz_draws >= 0);
create index profiles_blitz_rating_idx on public.profiles (blitz_rating desc);

alter table public.battles
  add column mode text not null default 'standard' check (mode in ('standard', 'blitz'));

alter table public.matchmaking_queue
  add column mode text not null default 'standard' check (mode in ('standard', 'blitz'));

-- ---------------------------------------------------------------------------
-- ratings by mode (internal)
-- ---------------------------------------------------------------------------
create function public.mode_rating(p_user uuid, p_mode text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_mode = 'blitz' then blitz_rating else rating end
  from public.profiles where id = p_user;
$$;

-- Moves a player's rating for that mode and counts the result in that mode's record.
create function public.apply_rating(p_user uuid, p_mode text, p_delta integer, p_result text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_mode = 'blitz' then
    update public.profiles set
      blitz_rating = blitz_rating + p_delta,
      blitz_wins = blitz_wins + (p_result = 'win')::int,
      blitz_losses = blitz_losses + (p_result = 'loss')::int,
      blitz_draws = blitz_draws + (p_result = 'draw')::int
    where id = p_user;
  else
    update public.profiles set
      rating = rating + p_delta,
      wins = wins + (p_result = 'win')::int,
      losses = losses + (p_result = 'loss')::int,
      draws = draws + (p_result = 'draw')::int
    where id = p_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- rating changes use the battle's mode
-- ---------------------------------------------------------------------------
create or replace function public.finish_battle(p_battle uuid, p_winner uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_rated boolean;
  v_mode text;
  v_a uuid;
  v_b uuid;
  v_ra integer;
  v_rb integer;
  v_score_a numeric;
  v_expected_a numeric;
  v_new_a integer;
  v_new_b integer;
  k constant integer := 32;
begin
  select status, is_rated, mode into v_status, v_rated, v_mode from public.battles where id = p_battle for update;
  if not found or v_status <> 'active' then
    return false;
  end if;

  -- Deterministic order (by user id) so two concurrent finishes cannot deadlock.
  select min(user_id::text)::uuid, max(user_id::text)::uuid into v_a, v_b
  from public.battle_players where battle_id = p_battle;

  if v_a is null or v_a = v_b then
    raise exception 'BATTLE_CORRUPT';
  end if;
  if p_winner is not null and p_winner not in (v_a, v_b) then
    raise exception 'WINNER_NOT_PARTICIPANT';
  end if;

  v_score_a := case when p_winner is null then 0.5 when p_winner = v_a then 1 else 0 end;

  if v_rated then
    perform 1 from public.profiles where id in (v_a, v_b) order by id for update;
    v_ra := public.mode_rating(v_a, v_mode);
    v_rb := public.mode_rating(v_b, v_mode);

    v_expected_a := 1 / (1 + power(10::numeric, (v_rb - v_ra) / 400.0));
    v_new_a := round(v_ra + k * (v_score_a - v_expected_a));
    v_new_b := round(v_rb + k * ((1 - v_score_a) - (1 - v_expected_a)));

    perform public.apply_rating(v_a, v_mode, v_new_a - v_ra,
      case when v_score_a = 1 then 'win' when v_score_a = 0 then 'loss' else 'draw' end);
    perform public.apply_rating(v_b, v_mode, v_new_b - v_rb,
      case when v_score_a = 0 then 'win' when v_score_a = 1 then 'loss' else 'draw' end);
  else
    -- Custom match: the result is recorded, the rating stays where it was.
    select rating_before into v_ra from public.battle_players where battle_id = p_battle and user_id = v_a;
    select rating_before into v_rb from public.battle_players where battle_id = p_battle and user_id = v_b;
    v_new_a := v_ra;
    v_new_b := v_rb;
  end if;

  update public.battle_players set
    is_active = false,
    rating_before = v_ra,
    rating_after = v_new_a,
    result = case when v_score_a = 1 then 'win' when v_score_a = 0 then 'loss' else 'draw' end
  where battle_id = p_battle and user_id = v_a;

  update public.battle_players set
    is_active = false,
    rating_before = v_rb,
    rating_after = v_new_b,
    result = case when v_score_a = 0 then 'win' when v_score_a = 1 then 'loss' else 'draw' end
  where battle_id = p_battle and user_id = v_b;

  update public.battles set
    status = 'finished',
    finished_at = now(),
    winner_id = p_winner,
    finish_reason = p_reason
  where id = p_battle;

  return true;
end;
$$;

create or replace function public.start_overtime(p_battle uuid, p_winner uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_loser uuid;
  v_rw integer;
  v_rl integer;
  v_gain integer := 0;
  v_expected numeric;
  v_ends timestamptz;
  k constant integer := 32;
begin
  select * into v_battle from public.battles where id = p_battle for update;
  if not found or v_battle.status <> 'active' or v_battle.overtime_ends_at is not null then
    return false;
  end if;

  select user_id into v_loser
  from public.battle_players where battle_id = p_battle and user_id <> p_winner;
  if v_loser is null then
    raise exception 'BATTLE_CORRUPT';
  end if;

  if v_battle.is_rated then
    -- Lock both profiles in id order so concurrent rating updates cannot deadlock.
    perform 1 from public.profiles where id in (p_winner, v_loser) order by id for update;
    v_rw := public.mode_rating(p_winner, v_battle.mode);
    v_rl := public.mode_rating(v_loser, v_battle.mode);
    v_expected := 1 / (1 + power(10::numeric, (v_rl - v_rw) / 400.0));
    v_gain := round(k * (1 - v_expected));
    perform public.apply_rating(p_winner, v_battle.mode, v_gain, 'win');
  else
    select rating_before into v_rw from public.battle_players where battle_id = p_battle and user_id = p_winner;
    select rating_before into v_rl from public.battle_players where battle_id = p_battle and user_id = v_loser;
  end if;

  update public.battle_players set
    is_active = false,
    rating_before = v_rw,
    rating_after = v_rw + v_gain,
    result = 'win'
  where battle_id = p_battle and user_id = p_winner;

  update public.battle_players set rating_before = v_rl
  where battle_id = p_battle and user_id = v_loser;

  -- Blitz overtime is 1 minute; otherwise 2.
  v_ends := least(
    now() + case when v_battle.mode = 'blitz' then interval '1 minute' else interval '2 minutes' end,
    v_battle.ends_at
  );
  update public.battles set
    winner_id = p_winner,
    first_solved_at = now(),
    loser_full_delta = -v_gain,
    overtime_ends_at = v_ends
  where id = p_battle;

  -- Solved in the very last moment: no time left for overtime.
  if v_ends <= now() then
    perform public.finish_overtime(p_battle, 'timeout');
  end if;
  return true;
end;
$$;

create or replace function public.finish_overtime(p_battle uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_loser uuid;
  v_delta integer;
begin
  if p_outcome is null or p_outcome not in ('solved', 'gave_up', 'timeout') then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_battle from public.battles where id = p_battle for update;
  if not found or v_battle.status <> 'active' or v_battle.overtime_ends_at is null then
    return false;
  end if;

  select user_id into v_loser
  from public.battle_players where battle_id = p_battle and user_id <> v_battle.winner_id;

  -- Integer division rounds toward zero: half of -15 is -7, in the loser's favour.
  v_delta := case
    when p_outcome = 'solved' then v_battle.loser_full_delta / 2
    else v_battle.loser_full_delta
  end;

  if v_battle.is_rated then
    perform public.apply_rating(v_loser, v_battle.mode, v_delta, 'loss');
  end if;

  update public.battle_players set
    is_active = false,
    rating_after = rating_before + v_delta,
    result = 'loss',
    solved_in_overtime = (p_outcome = 'solved')
  where battle_id = p_battle and user_id = v_loser;

  update public.battles set
    status = 'finished',
    finished_at = now(),
    finish_reason = 'solved',
    overtime_outcome = p_outcome
  where id = p_battle;

  return true;
end;
$$;

create or replace function public.begin_submission(
  p_user uuid,
  p_battle uuid,
  p_kind text,
  p_language text,
  p_code text,
  p_daily_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_problem public.problems;
  v_total integer;
  v_last timestamptz;
  v_cooldown interval;
  v_wait_ms bigint;
  v_day date := (now() at time zone 'utc')::date;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('run', 'submit')
    or p_language is null or p_language not in ('python', 'java', 'cpp', 'javascript')
    or p_code is null or octet_length(p_code) not between 1 and 65536 then
    raise exception 'INVALID_INPUT';
  end if;

  select * into v_battle from public.battles where id = p_battle;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  if v_battle.status <> 'active'
    or now() >= coalesce(v_battle.overtime_ends_at, v_battle.ends_at)
    or (v_battle.overtime_ends_at is not null and v_battle.winner_id = p_user) then
    raise exception 'BATTLE_NOT_ACTIVE';
  end if;
  if now() < v_battle.starts_at then
    raise exception 'BATTLE_NOT_STARTED';
  end if;

  -- A submission stuck in judging (Worker died) must not block the player forever.
  update public.submissions
  set status = 'error', verdict = 'internal_error', judged_at = now()
  where user_id = p_user and status = 'judging'
    and created_at < now() - interval '90 seconds';

  if exists (select 1 from public.submissions where user_id = p_user and status = 'judging') then
    raise exception 'SUBMISSION_IN_FLIGHT';
  end if;

  -- Blitz submits wait 5 seconds instead of 10.
  v_cooldown := case
    when p_kind = 'submit' and v_battle.mode = 'blitz' then interval '5 seconds'
    when p_kind = 'submit' then interval '10 seconds'
    else interval '5 seconds'
  end;
  select max(created_at) into v_last
  from public.submissions
  where user_id = p_user and battle_id = p_battle and kind = p_kind and status <> 'error';
  if v_last is not null and now() - v_last < v_cooldown then
    v_wait_ms := ceil(extract(epoch from (v_last + v_cooldown - now())) * 1000);
    raise exception 'COOLDOWN' using detail = v_wait_ms::text;
  end if;

  select * into v_problem from public.problems where id = v_battle.problem_id;
  if p_kind = 'run' then
    v_total := jsonb_array_length(v_problem.samples);
  else
    select count(*) into v_total from public.problem_tests where problem_id = v_problem.id;
  end if;

  -- Reserve judge executions atomically; unused ones are returned on completion.
  if p_daily_limit is not null then
    insert into public.judge_usage (day, executions) values (v_day, 0)
    on conflict (day) do nothing;
    update public.judge_usage set executions = executions + v_total
    where day = v_day and executions + v_total <= p_daily_limit;
    if not found then
      raise exception 'JUDGE_QUOTA_EXHAUSTED';
    end if;
  end if;

  insert into public.submissions (
    battle_id, user_id, kind, language, source_code, total, reserved_executions
  )
  values (
    p_battle, p_user, p_kind, p_language, p_code, v_total,
    case when p_daily_limit is null then 0 else v_total end
  )
  returning id into v_id;

  return jsonb_build_object(
    'submission_id', v_id,
    'problem_id', v_problem.id,
    'total', v_total,
    'time_limit_ms', v_problem.time_limit_ms,
    'memory_limit_kb', v_problem.memory_limit_kb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- matchmaking takes a mode (standard or blitz); each mode has its own queue
-- ---------------------------------------------------------------------------
drop function public.find_match(uuid);
create function public.find_match(p_user uuid, p_mode text default 'standard')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rating integer;
  v_active uuid;
  v_joined timestamptz;
  v_heartbeat timestamptz;
  v_opp uuid;
  v_opp_rating integer;
  v_tier text;
  v_problem uuid;
  v_battle uuid;
  v_starts timestamptz;
begin
  if p_mode is null or p_mode not in ('standard', 'blitz') then
    raise exception 'INVALID_INPUT';
  end if;

  -- One matchmaking decision at a time. Simple and race-free at MVP scale.
  perform pg_advisory_xact_lock(hashtext('code_wars.matchmaking'));

  select battle_id into v_active
  from public.battle_players where user_id = p_user and is_active;
  if found and not public.finalize_battle_if_expired(v_active) then
    delete from public.matchmaking_queue where user_id = p_user;
    return jsonb_build_object('status', 'matched', 'battle_id', v_active);
  end if;

  select case when p_mode = 'blitz' then blitz_rating else rating end into v_rating
  from public.profiles where id = p_user;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  -- Drop opponents whose client stopped sending heartbeats.
  delete from public.matchmaking_queue
  where user_id <> p_user and heartbeat_at < now() - interval '15 seconds';

  select joined_at, heartbeat_at into v_joined, v_heartbeat
  from public.matchmaking_queue where user_id = p_user and mode = p_mode;

  if not found or v_heartbeat < now() - interval '15 seconds' then
    v_joined := now();
  elsif now() - v_joined > interval '60 seconds' then
    delete from public.matchmaking_queue where user_id = p_user;
    return jsonb_build_object('status', 'timeout');
  end if;

  -- Closest-rated opponent where both players' windows cover the gap.
  select q.user_id into v_opp
  from public.matchmaking_queue q
  where q.user_id <> p_user
    and q.mode = p_mode
    and abs(q.rating - v_rating) <= public.match_window(v_joined)
    and abs(q.rating - v_rating) <= public.match_window(q.joined_at)
  order by abs(q.rating - v_rating), q.joined_at
  limit 1;

  if v_opp is null then
    insert into public.matchmaking_queue (user_id, rating, joined_at, heartbeat_at, mode)
    values (p_user, v_rating, v_joined, now(), p_mode)
    on conflict (user_id) do update
      set rating = excluded.rating, joined_at = excluded.joined_at, heartbeat_at = now(),
        mode = excluded.mode;
    return jsonb_build_object(
      'status', 'queued',
      'waited_ms', floor(extract(epoch from (now() - v_joined)) * 1000)::bigint
    );
  end if;

  select case when p_mode = 'blitz' then blitz_rating else rating end into v_opp_rating
  from public.profiles where id = v_opp;

  v_tier := case
    when p_mode = 'blitz' then 'easy'
    when (v_rating + v_opp_rating) / 2 < 1300 then 'easy'
    when (v_rating + v_opp_rating) / 2 < 1600 then 'medium'
    else 'hard'
  end;

  -- Prefer the right difficulty, then problems neither player has had before.
  select p.id into v_problem
  from public.problems p
  where p.is_active
    and exists (select 1 from public.problem_tests t where t.problem_id = p.id)
    and (p_mode <> 'blitz' or p.difficulty = 'easy')
  order by
    (p.difficulty = v_tier) desc,
    (
      select count(*) from public.battles b
      join public.battle_players bp on bp.battle_id = b.id
      where b.problem_id = p.id and bp.user_id in (p_user, v_opp)
    ),
    random()
  limit 1;

  if v_problem is null then
    raise exception 'NO_PROBLEMS_AVAILABLE';
  end if;

  delete from public.matchmaking_queue where user_id in (p_user, v_opp);

  v_starts := now() + interval '10 seconds';
  insert into public.battles (problem_id, starts_at, ends_at, mode)
  values (
    v_problem, v_starts,
    v_starts + case when p_mode = 'blitz' then interval '5 minutes' else interval '15 minutes' end,
    p_mode
  )
  returning id into v_battle;

  insert into public.battle_players (battle_id, user_id, rating_before)
  values (v_battle, p_user, v_rating), (v_battle, v_opp, v_opp_rating);

  return jsonb_build_object('status', 'matched', 'battle_id', v_battle);
end;
$$;

-- A rematch keeps the mode (and Blitz rematches use Blitz ratings).
create or replace function public.start_rematch(p_battle uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.battles;
  v_difficulty text;
  v_a uuid;
  v_b uuid;
  v_rated boolean;
  v_problem uuid;
  v_battle uuid;
  v_starts timestamptz;
begin
  select * into v_old from public.battles where id = p_battle;
  select difficulty into v_difficulty from public.problems where id = v_old.problem_id;
  select min(user_id::text)::uuid, max(user_id::text)::uuid into v_a, v_b
  from public.battle_players where battle_id = p_battle;
  v_rated := public.rematch_is_rated(p_battle);

  -- Same difficulty, never the same problem again (when there is another).
  select p.id into v_problem
  from public.problems p
  where p.is_active
    and p.difficulty = v_difficulty
    and p.id <> v_old.problem_id
    and exists (select 1 from public.problem_tests t where t.problem_id = p.id)
  order by
    (
      select count(*) from public.battles b
      join public.battle_players bp on bp.battle_id = b.id
      where b.problem_id = p.id and bp.user_id in (v_a, v_b)
    ),
    random()
  limit 1;
  v_problem := coalesce(v_problem, public.pick_problem(v_difficulty, v_a, v_b));
  if v_problem is null then
    raise exception 'NO_PROBLEMS_AVAILABLE';
  end if;

  delete from public.matchmaking_queue where user_id in (v_a, v_b);
  perform public.leave_open_rooms(v_a);
  perform public.leave_open_rooms(v_b);

  v_starts := now() + interval '10 seconds';
  insert into public.battles (problem_id, starts_at, ends_at, is_rated, rematch_of, mode)
  values (
    v_problem, v_starts, v_starts + (v_old.ends_at - v_old.starts_at), v_rated, p_battle, v_old.mode
  )
  returning id into v_battle;

  -- Accepted before the players are added, so the "entering a battle cancels
  -- offers" trigger leaves this one alone.
  update public.rematches set status = 'accepted', responded_at = now(), new_battle_id = v_battle
  where battle_id = p_battle;

  insert into public.battle_players (battle_id, user_id, rating_before)
  select v_battle, p.id, case when v_old.mode = 'blitz' then p.blitz_rating else p.rating end
  from public.profiles p where p.id in (v_a, v_b);
  return v_battle;
end;
$$;

-- Battle state says which mode the battle is.
create or replace function public.get_battle_state(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_problem public.problems;
  v_other uuid;
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
  select user_id into v_other from public.battle_players where battle_id = p_battle and user_id <> p_user;

  return jsonb_build_object(
    'server_time', now(),
    'battle', jsonb_build_object(
      'id', v_battle.id,
      'status', v_battle.status,
      'starts_at', v_battle.starts_at,
      'ends_at', v_battle.ends_at,
      'finished_at', v_battle.finished_at,
      'winner_id', v_battle.winner_id,
      'finish_reason', v_battle.finish_reason,
      'is_rated', v_battle.is_rated,
      'mode', v_battle.mode,
      'room_code', (select code from public.custom_rooms where battle_id = p_battle limit 1),
      'first_solved_at', v_battle.first_solved_at,
      'overtime_ends_at', v_battle.overtime_ends_at,
      'overtime_outcome', v_battle.overtime_outcome,
      'overtime_full_delta', v_battle.loser_full_delta,
      'rematch_of', v_battle.rematch_of,
      -- Results between the two players in the last 24 hours (not counting this battle until it ends).
      'series', public.series_score(p_user, v_other)
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
          'result', bp.result,
          'solved_in_overtime', bp.solved_in_overtime
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

-- Public profiles: Ranked stats count Ranked battles only; Blitz has its own numbers.
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

  -- Current streak: how many of the most recent ranked results are the same.
  for v_row in
    select bp.result
    from public.battle_players bp
    join public.battles b on b.id = bp.battle_id
    where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
      and bp.result is not null
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
    where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
      and bp.rating_after is not null
    order by b.finished_at desc
    limit 10
  ) recent;

  return jsonb_build_object(
    'username', v_profile.username,
    'avatar', v_profile.avatar,
    'rating', v_profile.rating,
    'blitz_rating', v_profile.blitz_rating,
    'blitz_wins', v_profile.blitz_wins,
    'blitz_losses', v_profile.blitz_losses,
    'blitz_draws', v_profile.blitz_draws,
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
        where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
      )
    ),
    'streak', case
      when v_streak = 0 then null
      else jsonb_build_object('result', v_streak_result, 'count', v_streak)
    end,
    'rating_history', coalesce(
      (
        select jsonb_agg(value order by position)
        from (
          select 0 as position, first_battle.rating_before as value
          from (
            select bp.rating_before
            from public.battle_players bp
            join public.battles b on b.id = bp.battle_id
            where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
              and bp.rating_after is not null
            order by b.finished_at
            limit 1
          ) first_battle
          union all
          select
            row_number() over (order by b.finished_at) as position,
            bp.rating_after as value
          from public.battle_players bp
          join public.battles b on b.id = bp.battle_id
          where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
            and bp.rating_after is not null
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
          where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated and b.mode = 'standard'
            and bp.language is not null
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
      where bp.user_id = v_profile.id and bp.result = 'win' and b.is_rated and b.mode = 'standard'
    ),
    'recent_battles', v_battles
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Blitz rankings
-- ---------------------------------------------------------------------------
create view public.blitz_leaderboard
with (security_invoker = true) as
select
  p.id,
  p.username,
  p.avatar,
  p.blitz_rating as rating,
  p.blitz_wins as wins,
  p.blitz_losses as losses,
  p.blitz_draws as draws,
  rank() over (order by p.blitz_rating desc) as rank
from public.profiles p;

grant select on public.blitz_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- grants: internal helpers and the new matchmaking signature, service role only
-- ---------------------------------------------------------------------------
revoke execute on function public.mode_rating(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_rating(uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public.find_match(uuid, text) from public, anon, authenticated;
grant execute on function public.mode_rating(uuid, text) to service_role;
grant execute on function public.apply_rating(uuid, text, integer, text) to service_role;
grant execute on function public.find_match(uuid, text) to service_role;
