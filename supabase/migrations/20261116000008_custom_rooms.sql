-- Custom matches: a player creates a room, shares its 6-character code, a
-- friend joins with it and the host starts an unrated battle.
--
-- Approved rules (2026-11-16):
--   1. Custom battles are unrated: rating, wins, losses and draws never change,
--      and public profile statistics count ranked battles only.
--   2. Codes are 6 characters from an alphabet without look-alikes (no 0/O,
--      1/I/L), case-insensitive. One open room per player. An open room
--      expires 30 minutes after it is made.
--   3. Only the host starts the battle. The problem is picked by the server at
--      that moment, so nobody sees it in advance.
--
-- As everywhere else, clients only read (RLS); every change goes through the
-- Worker and the functions below, which are callable by service_role only.

-- ---------------------------------------------------------------------------
-- battles: ranked or not
-- ---------------------------------------------------------------------------
alter table public.battles add column is_rated boolean not null default true;

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table public.custom_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$'),
  host_id uuid not null references public.profiles (id) on delete cascade,
  guest_id uuid references public.profiles (id) on delete set null,
  difficulty text not null default 'any' check (difficulty in ('any', 'easy', 'medium', 'hard')),
  duration_minutes integer not null default 15 check (duration_minutes in (10, 15, 30)),
  status text not null default 'open' check (status in ('open', 'started', 'closed', 'expired')),
  battle_id uuid references public.battles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  started_at timestamptz,
  check (guest_id is null or guest_id <> host_id),
  check ((status = 'started') = (battle_id is not null or started_at is not null))
);

-- A code identifies at most one open room; a player hosts or sits in at most one.
create unique index custom_rooms_open_code on public.custom_rooms (code) where status = 'open';
create unique index custom_rooms_one_open_per_host
  on public.custom_rooms (host_id) where status = 'open';
create unique index custom_rooms_one_open_per_guest
  on public.custom_rooms (guest_id) where status = 'open' and guest_id is not null;
create index custom_rooms_code_idx on public.custom_rooms (code, created_at desc);
create index custom_rooms_battle_idx on public.custom_rooms (battle_id);

alter table public.custom_rooms enable row level security;
revoke all on public.custom_rooms from anon, authenticated;
grant select on public.custom_rooms to authenticated;
grant all on public.custom_rooms to service_role;

-- Only the two people in a room can read it (also what Realtime delivers).
create policy "host and guest can read their room"
  on public.custom_rooms for select
  to authenticated
  using (host_id = auth.uid() or guest_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.custom_rooms;
  end if;
end;
$$;

-- Ranked battles only: custom battles never appear in rating history.
create or replace view public.rating_history
with (security_invoker = true) as
select
  bp.user_id,
  bp.battle_id,
  bp.rating_before,
  bp.rating_after,
  bp.rating_after - bp.rating_before as delta,
  bp.result,
  b.finished_at
from public.battle_players bp
join public.battles b on b.id = bp.battle_id
where b.status = 'finished'
  and b.is_rated
  and bp.rating_after is not null;

-- ---------------------------------------------------------------------------
-- finishing battles: unrated ones leave ratings and records alone
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
  select status, is_rated into v_status, v_rated from public.battles where id = p_battle for update;
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
    select rating into v_ra from public.profiles where id = v_a for update;
    select rating into v_rb from public.profiles where id = v_b for update;

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

-- ---------------------------------------------------------------------------
-- room helpers (internal)
-- ---------------------------------------------------------------------------
create function public.expire_rooms()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.custom_rooms set status = 'expired'
  where status = 'open' and expires_at <= now();
$$;

-- Upper-cases and trims a typed code; null if it cannot be a room code.
create function public.normalize_room_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when upper(btrim(coalesce(p_code, ''))) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$'
      then upper(btrim(p_code))
    else null
  end;
$$;

-- True if the player is in a battle that is still running. Ends the battle
-- first if its time is already up.
create function public.in_active_battle(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle uuid;
begin
  select battle_id into v_battle from public.battle_players where user_id = p_user and is_active;
  if not found then
    return false;
  end if;
  perform public.finalize_battle_if_expired(v_battle);
  return exists (select 1 from public.battle_players where user_id = p_user and is_active);
end;
$$;

-- Takes the player out of any open room before they make or join another.
create function public.leave_open_rooms(p_user uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.custom_rooms set status = 'closed' where host_id = p_user and status = 'open';
  update public.custom_rooms set guest_id = null where guest_id = p_user and status = 'open';
$$;

create function public.room_player(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'avatar', p.avatar, 'rating', p.rating
  )
  from public.profiles p where p.id = p_user;
$$;

-- What a player sees of a room.
create function public.room_json(p_room uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'server_time', now(),
    'id', r.id,
    'code', r.code,
    'status', r.status,
    'difficulty', r.difficulty,
    'duration_minutes', r.duration_minutes,
    'expires_at', r.expires_at,
    'battle_id', r.battle_id,
    'is_host', r.host_id = p_user,
    'host', public.room_player(r.host_id),
    'guest', case when r.guest_id is null then null else public.room_player(r.guest_id) end
  )
  from public.custom_rooms r where r.id = p_room;
$$;

-- Opens a room for the host with a fresh code.
create function public.open_room(p_host uuid, p_difficulty text, p_minutes integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_id uuid;
begin
  for attempt in 1..20 loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
    into v_code
    from generate_series(1, 6);
    begin
      insert into public.custom_rooms (code, host_id, difficulty, duration_minutes, expires_at)
      values (v_code, p_host, p_difficulty, p_minutes, now() + interval '30 minutes')
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      -- Another open room has this code: try another one.
      null;
    end;
  end loop;
  raise exception 'ROOM_CODE_EXHAUSTED';
end;
$$;

-- ---------------------------------------------------------------------------
-- room actions (called by the Worker with the signed-in user's id)
-- ---------------------------------------------------------------------------
create function public.create_room(p_user uuid, p_difficulty text, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_difficulty is null or p_difficulty not in ('any', 'easy', 'medium', 'hard')
    or p_minutes is null or p_minutes not in (10, 15, 30) then
    raise exception 'INVALID_INPUT';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'NOT_FOUND';
  end if;

  -- One room action per player at a time.
  perform pg_advisory_xact_lock(hashtext('code_wars.room:' || p_user));
  perform public.expire_rooms();
  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;

  perform public.leave_open_rooms(p_user);
  delete from public.matchmaking_queue where user_id = p_user;
  v_id := public.open_room(p_user, p_difficulty, p_minutes);
  return public.room_json(v_id, p_user);
end;
$$;

-- The open room the player is in, as host or guest, or null.
create function public.get_current_room(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.expire_rooms();
  select id into v_id from public.custom_rooms
  where status = 'open' and (host_id = p_user or guest_id = p_user)
  order by created_at desc limit 1;
  return case when v_id is null then null else public.room_json(v_id, p_user) end;
end;
$$;

-- A room by id, for its host or guest. Includes the battle id once started.
create function public.get_room(p_user uuid, p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.expire_rooms();
  if not exists (select 1 from public.custom_rooms where id = p_room) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.custom_rooms
    where id = p_room and (host_id = p_user or guest_id = p_user)
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  return public.room_json(p_room, p_user);
end;
$$;

-- Looks a room up by code before joining: who hosts it and its settings.
create function public.get_room_by_code(p_user uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := public.normalize_room_code(p_code);
  v_room public.custom_rooms;
begin
  if v_code is null then
    raise exception 'INVALID_INPUT';
  end if;
  perform public.expire_rooms();

  select * into v_room from public.custom_rooms
  where code = v_code order by created_at desc limit 1;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status = 'expired' then
    raise exception 'ROOM_EXPIRED';
  end if;
  if v_room.status <> 'open' then
    -- Already started or closed: only its own players may still look at it.
    if p_user in (v_room.host_id, v_room.guest_id) then
      return public.room_json(v_room.id, p_user);
    end if;
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.guest_id is not null and v_room.guest_id <> p_user and v_room.host_id <> p_user then
    raise exception 'ROOM_FULL';
  end if;
  return public.room_json(v_room.id, p_user);
end;
$$;

create function public.join_room(p_user uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := public.normalize_room_code(p_code);
  v_room public.custom_rooms;
begin
  if v_code is null then
    raise exception 'INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtext('code_wars.room:' || p_user));
  perform public.expire_rooms();

  select * into v_room from public.custom_rooms
  where code = v_code order by created_at desc limit 1
  for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status = 'expired' then
    raise exception 'ROOM_EXPIRED';
  end if;
  if v_room.status <> 'open' then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.host_id = p_user then
    raise exception 'ROOM_OWN';
  end if;
  if v_room.guest_id = p_user then
    return public.room_json(v_room.id, p_user);
  end if;
  if v_room.guest_id is not null then
    raise exception 'ROOM_FULL';
  end if;
  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;

  perform public.leave_open_rooms(p_user);
  delete from public.matchmaking_queue where user_id = p_user;
  update public.custom_rooms set guest_id = p_user where id = v_room.id;
  return public.room_json(v_room.id, p_user);
end;
$$;

-- The host closes the room; the guest leaves it (and the host can wait for
-- someone else). Does nothing once the room is no longer open.
create function public.leave_room(p_user uuid, p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.custom_rooms;
begin
  select * into v_room from public.custom_rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if p_user is distinct from v_room.host_id and p_user is distinct from v_room.guest_id then
    raise exception 'NOT_PARTICIPANT';
  end if;
  if v_room.status = 'open' then
    if v_room.host_id = p_user then
      update public.custom_rooms set status = 'closed' where id = p_room;
    else
      update public.custom_rooms set guest_id = null where id = p_room;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The host starts the battle: picks the problem now and creates an unrated battle.
create function public.start_room(p_user uuid, p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.custom_rooms;
  v_problem uuid;
  v_battle uuid;
  v_starts timestamptz;
begin
  perform public.expire_rooms();
  select * into v_room from public.custom_rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.host_id <> p_user then
    if v_room.guest_id = p_user then
      raise exception 'NOT_HOST';
    end if;
    raise exception 'NOT_PARTICIPANT';
  end if;
  if v_room.status = 'started' then
    return public.room_json(p_room, p_user);
  end if;
  if v_room.status = 'expired' then
    raise exception 'ROOM_EXPIRED';
  end if;
  if v_room.status <> 'open' then
    raise exception 'ROOM_NOT_OPEN';
  end if;
  if v_room.guest_id is null then
    raise exception 'ROOM_NOT_READY';
  end if;
  if public.in_active_battle(v_room.host_id) or public.in_active_battle(v_room.guest_id) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;

  -- The chosen difficulty (any: all), preferring problems neither has had.
  select p.id into v_problem
  from public.problems p
  where p.is_active
    and (v_room.difficulty = 'any' or p.difficulty = v_room.difficulty)
    and exists (select 1 from public.problem_tests t where t.problem_id = p.id)
  order by
    (
      select count(*) from public.battles b
      join public.battle_players bp on bp.battle_id = b.id
      where b.problem_id = p.id and bp.user_id in (v_room.host_id, v_room.guest_id)
    ),
    random()
  limit 1;
  if v_problem is null then
    raise exception 'NO_PROBLEMS_AVAILABLE';
  end if;

  delete from public.matchmaking_queue where user_id in (v_room.host_id, v_room.guest_id);

  v_starts := now() + interval '10 seconds';
  insert into public.battles (problem_id, starts_at, ends_at, is_rated)
  values (v_problem, v_starts, v_starts + make_interval(mins => v_room.duration_minutes), false)
  returning id into v_battle;

  insert into public.battle_players (battle_id, user_id, rating_before)
  select v_battle, p.id, p.rating from public.profiles p
  where p.id in (v_room.host_id, v_room.guest_id);

  update public.custom_rooms
  set status = 'started', battle_id = v_battle, started_at = now()
  where id = p_room;

  return public.room_json(p_room, p_user);
end;
$$;

-- After a custom battle: a new room with the same settings. If the other
-- player already made one for this pair, that room is returned instead; if
-- they are free, they are put straight in as the guest.
create function public.rematch_room(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_other uuid;
  v_old public.custom_rooms;
  v_existing uuid;
  v_id uuid;
begin
  select * into v_battle from public.battles where id = p_battle;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  if v_battle.is_rated or v_battle.status <> 'finished' then
    raise exception 'INVALID_INPUT';
  end if;
  select user_id into v_other
  from public.battle_players where battle_id = p_battle and user_id <> p_user;

  -- Both players lock in the same order, so two rematch clicks cannot deadlock.
  perform pg_advisory_xact_lock(hashtext('code_wars.room:' || least(p_user, v_other)::text));
  perform pg_advisory_xact_lock(hashtext('code_wars.room:' || greatest(p_user, v_other)::text));
  perform public.expire_rooms();

  select id into v_existing from public.custom_rooms
  where status = 'open' and host_id = v_other and guest_id = p_user;
  if v_existing is not null then
    return public.room_json(v_existing, p_user);
  end if;

  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;

  select * into v_old from public.custom_rooms where battle_id = p_battle;
  perform public.leave_open_rooms(p_user);
  v_id := public.open_room(
    p_user,
    coalesce(v_old.difficulty, 'any'),
    coalesce(v_old.duration_minutes, 15)
  );

  if not public.in_active_battle(v_other)
    and not exists (
      select 1 from public.custom_rooms
      where status = 'open' and (host_id = v_other or guest_id = v_other)
    ) then
    update public.custom_rooms set guest_id = v_other where id = v_id;
  end if;
  return public.room_json(v_id, p_user);
end;
$$;

-- Housekeeping now also expires rooms nobody started in time.
create or replace function public.sweep_stale()
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

  perform public.expire_rooms();
end;
$$;

-- ---------------------------------------------------------------------------
-- battle state: says whether the battle is ranked and, if not, its room code
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
      'room_code', (select code from public.custom_rooms where battle_id = p_battle limit 1)
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

-- ---------------------------------------------------------------------------
-- public profiles: ranked battles only (custom matches stay private)
-- ---------------------------------------------------------------------------
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
    where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
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
    where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
      and bp.rating_after is not null
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
        where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
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
            where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
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
          where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
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
          where bp.user_id = v_profile.id and b.status = 'finished' and b.is_rated
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
      where bp.user_id = v_profile.id and bp.result = 'win' and b.is_rated
    ),
    'recent_battles', v_battles
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- function privileges: new functions are callable by the Worker only
-- ---------------------------------------------------------------------------
revoke execute on function
  public.expire_rooms(),
  public.normalize_room_code(text),
  public.in_active_battle(uuid),
  public.leave_open_rooms(uuid),
  public.room_player(uuid),
  public.room_json(uuid, uuid),
  public.open_room(uuid, text, integer),
  public.create_room(uuid, text, integer),
  public.get_current_room(uuid),
  public.get_room(uuid, uuid),
  public.get_room_by_code(uuid, text),
  public.join_room(uuid, text),
  public.leave_room(uuid, uuid),
  public.start_room(uuid, uuid),
  public.rematch_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.expire_rooms(),
  public.normalize_room_code(text),
  public.in_active_battle(uuid),
  public.leave_open_rooms(uuid),
  public.room_player(uuid),
  public.room_json(uuid, uuid),
  public.open_room(uuid, text, integer),
  public.create_room(uuid, text, integer),
  public.get_current_room(uuid),
  public.get_room(uuid, uuid),
  public.get_room_by_code(uuid, text),
  public.join_room(uuid, text),
  public.leave_room(uuid, uuid),
  public.start_room(uuid, uuid),
  public.rematch_room(uuid, uuid)
to service_role;
