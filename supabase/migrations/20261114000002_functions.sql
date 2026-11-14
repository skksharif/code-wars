-- Code Wars functions. All trusted state changes happen here, each inside one
-- transaction. Errors are raised with a stable code as the message
-- (for example 'COOLDOWN'); the Worker maps these to HTTP responses.

-- ---------------------------------------------------------------------------
-- sign-up
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
begin
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    raise exception 'USERNAME_TAKEN';
  end if;
  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
    and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

-- Used by RLS policies. SECURITY DEFINER so that the policy on battle_players
-- does not recurse into itself. It only ever answers about the calling user.
create function public.is_battle_participant(p_battle uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.battle_players
    where battle_id = p_battle and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- battle completion (internal)
-- ---------------------------------------------------------------------------
-- The only code path that ends a battle. Idempotent: returns false and changes
-- nothing unless the battle is still active. p_winner null means a draw.
create function public.finish_battle(p_battle uuid, p_winner uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
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
  select status into v_status from public.battles where id = p_battle for update;
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

  select rating into v_ra from public.profiles where id = v_a for update;
  select rating into v_rb from public.profiles where id = v_b for update;

  v_score_a := case when p_winner is null then 0.5 when p_winner = v_a then 1 else 0 end;
  v_expected_a := 1 / (1 + power(10::numeric, (v_rb - v_ra) / 400.0));
  v_new_a := round(v_ra + k * (v_score_a - v_expected_a));
  v_new_b := round(v_rb + k * ((1 - v_score_a) - (1 - v_expected_a)));

  update public.profiles set
    rating = v_new_a,
    wins = wins + (v_score_a = 1)::int,
    losses = losses + (v_score_a = 0)::int,
    draws = draws + (v_score_a = 0.5)::int
  where id = v_a;

  update public.profiles set
    rating = v_new_b,
    wins = wins + (v_score_a = 0)::int,
    losses = losses + (v_score_a = 1)::int,
    draws = draws + (v_score_a = 0.5)::int
  where id = v_b;

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

-- Resolves a battle whose time is up: more hidden tests passed wins, equal is a draw.
-- Waits (returns false) while a submission that started in time is still being judged.
create function public.finalize_battle_if_expired(p_battle uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_top uuid;
  v_top_passed integer;
  v_low_passed integer;
begin
  select * into v_battle from public.battles where id = p_battle for update;
  if not found or v_battle.status <> 'active' or now() < v_battle.ends_at then
    return false;
  end if;

  if exists (
    select 1 from public.submissions
    where battle_id = p_battle
      and status = 'judging'
      and created_at > now() - interval '90 seconds'
  ) then
    return false;
  end if;

  select user_id, best_passed into v_top, v_top_passed
  from public.battle_players where battle_id = p_battle
  order by best_passed desc, user_id limit 1;

  select min(best_passed) into v_low_passed
  from public.battle_players where battle_id = p_battle;

  if v_top_passed = v_low_passed then
    return public.finish_battle(p_battle, null, 'timeout_draw');
  end if;
  return public.finish_battle(p_battle, v_top, 'timeout_score');
end;
$$;

create function public.finalize_expired_battles()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.battles where status = 'active' and ends_at <= now() order by ends_at
  loop
    if public.finalize_battle_if_expired(v_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- matchmaking
-- ---------------------------------------------------------------------------
-- Rating gap a queued player accepts: 100, plus 50 for every 10 seconds waited.
create function public.match_window(p_joined timestamptz)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select 100 + 50 * floor(greatest(0, extract(epoch from (now() - p_joined))) / 10)::integer;
$$;

-- Join the queue, refresh the heartbeat, or get paired. Call every 5 seconds
-- while searching. Returns {status: 'queued' | 'matched' | 'timeout', ...}.
create function public.find_match(p_user uuid)
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
  -- One matchmaking decision at a time. Simple and race-free at MVP scale.
  perform pg_advisory_xact_lock(hashtext('code_wars.matchmaking'));

  select battle_id into v_active
  from public.battle_players where user_id = p_user and is_active;
  if found and not public.finalize_battle_if_expired(v_active) then
    delete from public.matchmaking_queue where user_id = p_user;
    return jsonb_build_object('status', 'matched', 'battle_id', v_active);
  end if;

  select rating into v_rating from public.profiles where id = p_user;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  -- Drop opponents whose client stopped sending heartbeats.
  delete from public.matchmaking_queue
  where user_id <> p_user and heartbeat_at < now() - interval '15 seconds';

  select joined_at, heartbeat_at into v_joined, v_heartbeat
  from public.matchmaking_queue where user_id = p_user;

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
    and abs(q.rating - v_rating) <= public.match_window(v_joined)
    and abs(q.rating - v_rating) <= public.match_window(q.joined_at)
  order by abs(q.rating - v_rating), q.joined_at
  limit 1;

  if v_opp is null then
    insert into public.matchmaking_queue (user_id, rating, joined_at, heartbeat_at)
    values (p_user, v_rating, v_joined, now())
    on conflict (user_id) do update
      set rating = excluded.rating, joined_at = excluded.joined_at, heartbeat_at = now();
    return jsonb_build_object(
      'status', 'queued',
      'waited_ms', floor(extract(epoch from (now() - v_joined)) * 1000)::bigint
    );
  end if;

  select rating into v_opp_rating from public.profiles where id = v_opp;

  v_tier := case
    when (v_rating + v_opp_rating) / 2 < 1300 then 'easy'
    when (v_rating + v_opp_rating) / 2 < 1600 then 'medium'
    else 'hard'
  end;

  -- Prefer the right difficulty, then problems neither player has had before.
  select p.id into v_problem
  from public.problems p
  where p.is_active
    and exists (select 1 from public.problem_tests t where t.problem_id = p.id)
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
  insert into public.battles (problem_id, starts_at, ends_at)
  values (v_problem, v_starts, v_starts + interval '15 minutes')
  returning id into v_battle;

  insert into public.battle_players (battle_id, user_id, rating_before)
  values (v_battle, p_user, v_rating), (v_battle, v_opp, v_opp_rating);

  return jsonb_build_object('status', 'matched', 'battle_id', v_battle);
end;
$$;

create function public.cancel_matchmaking(p_user uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.matchmaking_queue where user_id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
-- Validates and records a Run or Submit before any code is sent to the judge.
-- p_daily_limit null means no judge quota (mock judge).
create function public.begin_submission(
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
  if v_battle.status <> 'active' or now() >= v_battle.ends_at then
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

  v_cooldown := case p_kind when 'submit' then interval '10 seconds' else interval '5 seconds' end;
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

-- Records the judge result. For a Submit this also updates the player's
-- progress and, on a full solve, ends the battle in the same transaction.
create function public.complete_submission(
  p_submission uuid,
  p_verdict text,
  p_passed integer,
  p_compile_output text default null,
  p_executions_used integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.submissions;
  v_status text;
  v_finished boolean := false;
  v_refund integer;
begin
  select * into v_sub from public.submissions where id = p_submission for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_sub.status <> 'judging' then
    raise exception 'SUBMISSION_NOT_JUDGING';
  end if;
  if p_verdict is null or p_passed is null or p_passed < 0 or p_passed > v_sub.total
    or (p_verdict = 'accepted') <> (p_passed = v_sub.total and v_sub.total > 0) then
    raise exception 'INVALID_INPUT';
  end if;

  update public.submissions set
    status = case when p_verdict = 'internal_error' then 'error' else 'done' end,
    verdict = p_verdict,
    passed = p_passed,
    compile_output = left(p_compile_output, 4000),
    judged_at = now()
  where id = p_submission;

  -- Give back reserved judge executions that were not used.
  if v_sub.reserved_executions > 0 and p_executions_used is not null then
    v_refund := v_sub.reserved_executions - greatest(0, p_executions_used);
    if v_refund > 0 then
      update public.judge_usage
      set executions = greatest(0, executions - v_refund)
      where day = (v_sub.created_at at time zone 'utc')::date;
    end if;
  end if;

  if v_sub.kind = 'submit' and p_verdict <> 'internal_error' then
    select status into v_status from public.battles where id = v_sub.battle_id for update;
    if v_status = 'active' then
      update public.battle_players set
        attempts = attempts + 1,
        language = v_sub.language,
        best_passed_at = case when p_passed > best_passed then now() else best_passed_at end,
        best_passed = greatest(best_passed, p_passed)
      where battle_id = v_sub.battle_id and user_id = v_sub.user_id;

      if p_verdict = 'accepted' then
        v_finished := public.finish_battle(v_sub.battle_id, v_sub.user_id, 'solved');
      end if;
    end if;
  end if;

  return jsonb_build_object('battle_finished', v_finished);
end;
$$;

-- ---------------------------------------------------------------------------
-- forfeit and housekeeping
-- ---------------------------------------------------------------------------
create function public.forfeit_battle(p_user uuid, p_battle uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opponent uuid;
begin
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  select user_id into v_opponent
  from public.battle_players where battle_id = p_battle and user_id <> p_user;

  if not public.finish_battle(p_battle, v_opponent, 'forfeit') then
    raise exception 'BATTLE_NOT_ACTIVE';
  end if;
end;
$$;

-- Clears submissions stuck in judging and queue rows nobody is refreshing.
create function public.sweep_stale()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.submissions
  set status = 'error', verdict = 'internal_error', judged_at = now()
  where status = 'judging' and created_at < now() - interval '90 seconds';

  delete from public.matchmaking_queue
  where heartbeat_at < now() - interval '15 seconds';
end;
$$;
