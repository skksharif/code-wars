-- Overtime (approved 2026-11-16, decision D17).
--
-- The first player to pass every hidden test wins at once and gets their full
-- rating gain straight away; they are free to leave or play again. The other
-- player then gets an overtime of 2 minutes (never past the original end time)
-- and can keep coding or give up:
--   solved in overtime -> their rating loss is halved (rounded in their favour)
--   gave up / time ran out -> the normal loss
-- Custom (unrated) battles follow the same flow without rating changes.

alter table public.battles
  add column first_solved_at timestamptz,
  add column overtime_ends_at timestamptz,
  -- The loser's rating change if they do not solve in overtime (0 when unrated).
  add column loser_full_delta integer,
  add column overtime_outcome text check (overtime_outcome in ('solved', 'gave_up', 'timeout'));

alter table public.battle_players
  add column solved_in_overtime boolean not null default false;

-- ---------------------------------------------------------------------------
-- step 1: the first full solve
-- ---------------------------------------------------------------------------
create function public.start_overtime(p_battle uuid, p_winner uuid)
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
    select rating into v_rw from public.profiles where id = p_winner;
    select rating into v_rl from public.profiles where id = v_loser;
    v_expected := 1 / (1 + power(10::numeric, (v_rl - v_rw) / 400.0));
    v_gain := round(k * (1 - v_expected));
    update public.profiles set rating = rating + v_gain, wins = wins + 1 where id = p_winner;
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

  v_ends := least(now() + interval '2 minutes', v_battle.ends_at);
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

-- ---------------------------------------------------------------------------
-- step 2: overtime ends (solved, gave up or timeout)
-- ---------------------------------------------------------------------------
create function public.finish_overtime(p_battle uuid, p_outcome text)
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
    update public.profiles set rating = rating + v_delta, losses = losses + 1 where id = v_loser;
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

-- ---------------------------------------------------------------------------
-- submissions: during overtime only the other player may submit, until
-- overtime ends; a full solve starts overtime or (in overtime) ends it
-- ---------------------------------------------------------------------------
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

create or replace function public.complete_submission(
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
  v_battle public.battles;
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
    select * into v_battle from public.battles where id = v_sub.battle_id for update;
    -- A player who already won cannot change anything; their battle is over.
    if v_battle.status = 'active'
      and not (v_battle.overtime_ends_at is not null and v_battle.winner_id = v_sub.user_id) then
      update public.battle_players set
        attempts = attempts + 1,
        language = v_sub.language,
        best_passed_at = case when p_passed > best_passed then now() else best_passed_at end,
        best_passed = greatest(best_passed, p_passed)
      where battle_id = v_sub.battle_id and user_id = v_sub.user_id;

      if p_verdict = 'accepted' then
        if v_battle.overtime_ends_at is null then
          -- First full solve: this player wins; the other gets overtime.
          v_finished := public.start_overtime(v_sub.battle_id, v_sub.user_id);
        else
          -- Solved in overtime: the battle ends with the loss halved.
          v_finished := public.finish_overtime(v_sub.battle_id, 'solved');
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('battle_finished', v_finished);
end;
$$;

-- ---------------------------------------------------------------------------
-- time-up and giving up
-- ---------------------------------------------------------------------------
create or replace function public.finalize_battle_if_expired(p_battle uuid)
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
  if not found or v_battle.status <> 'active'
    or now() < coalesce(v_battle.overtime_ends_at, v_battle.ends_at) then
    return false;
  end if;

  -- Wait for a submission that started in time and is still being judged.
  if exists (
    select 1 from public.submissions
    where battle_id = p_battle
      and status = 'judging'
      and created_at > now() - interval '90 seconds'
  ) then
    return false;
  end if;

  if v_battle.overtime_ends_at is not null then
    return public.finish_overtime(p_battle, 'timeout');
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

create or replace function public.finalize_expired_battles()
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
    select id from public.battles
    where status = 'active' and coalesce(overtime_ends_at, ends_at) <= now()
    order by coalesce(overtime_ends_at, ends_at)
  loop
    if public.finalize_battle_if_expired(v_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- In overtime, "Give up" ends the battle with the normal loss. The winner has
-- nothing left to give up.
create or replace function public.forfeit_battle(p_user uuid, p_battle uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_opponent uuid;
begin
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  select * into v_battle from public.battles where id = p_battle;
  if v_battle.overtime_ends_at is not null then
    if v_battle.winner_id = p_user or not public.finish_overtime(p_battle, 'gave_up') then
      raise exception 'BATTLE_NOT_ACTIVE';
    end if;
    return;
  end if;

  select user_id into v_opponent
  from public.battle_players where battle_id = p_battle and user_id <> p_user;

  if not public.finish_battle(p_battle, v_opponent, 'forfeit') then
    raise exception 'BATTLE_NOT_ACTIVE';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- battle state: overtime fields
-- ---------------------------------------------------------------------------
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
      'finish_reason', v_battle.finish_reason,
      'is_rated', v_battle.is_rated,
      'room_code', (select code from public.custom_rooms where battle_id = p_battle limit 1),
      'first_solved_at', v_battle.first_solved_at,
      'overtime_ends_at', v_battle.overtime_ends_at,
      'overtime_outcome', v_battle.overtime_outcome,
      -- What the loser keeps or loses, so the overtime offer can show it.
      'overtime_full_delta', v_battle.loser_full_delta
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

revoke execute on function
  public.start_overtime(uuid, uuid),
  public.finish_overtime(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.start_overtime(uuid, uuid),
  public.finish_overtime(uuid, text)
to service_role;
