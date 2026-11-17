-- Rematch after any battle (approved 2026-11-17, decision D19).
--
--   * Either player can ask for a rematch within 60 seconds of the battle
--     ending; it starts only when the other player also says yes.
--   * The rematch is the same kind of battle: ranked stays ranked, custom stays
--     unrated. Ranked rematches between the same two players count for rating
--     at most 2 times in 24 hours; after that they are unrated.
--   * A new problem of the same difficulty, with the same time limit.
--   * The offer ends early if either player starts another battle; a "no
--     thanks" ends it for that battle.
--   * The battle state carries a series score: results between the two players
--     in the last 24 hours.

alter table public.battles add column rematch_of uuid references public.battles (id) on delete set null;
create index battles_rematch_of_idx on public.battles (rematch_of);

create table public.rematches (
  -- One rematch offer per finished battle.
  battle_id uuid primary key references public.battles (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  cancel_reason text check (cancel_reason in ('withdrawn', 'busy')),
  new_battle_id uuid references public.battles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 60 seconds after the battle ended.
  expires_at timestamptz not null,
  responded_at timestamptz
);

alter table public.rematches enable row level security;
revoke all on public.rematches from anon, authenticated;
grant select on public.rematches to authenticated;
grant all on public.rematches to service_role;

create policy "battle players read their rematch"
  on public.rematches for select
  to authenticated
  using (public.is_battle_participant(battle_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rematches;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- helpers (internal)
-- ---------------------------------------------------------------------------
create function public.expire_rematches()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.rematches set status = 'expired', responded_at = now()
  where status = 'pending' and expires_at <= now();
$$;

-- Results between two players in the last 24 hours, from p_a's side.
create function public.series_score(p_a uuid, p_b uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'you', count(*) filter (where mine.result = 'win'),
    'them', count(*) filter (where mine.result = 'loss'),
    'draws', count(*) filter (where mine.result = 'draw')
  )
  from public.battle_players mine
  join public.battle_players theirs on theirs.battle_id = mine.battle_id and theirs.user_id = p_b
  join public.battles b on b.id = mine.battle_id
  where mine.user_id = p_a and b.status = 'finished' and b.finished_at > now() - interval '24 hours';
$$;

-- Whether a rematch of this battle would count for rating.
create function public.rematch_is_rated(p_battle uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.is_rated and (
    select count(*) from public.battles r
    where r.rematch_of is not null
      and r.is_rated
      and r.created_at > now() - interval '24 hours'
      and (select count(*) from public.battle_players x
           where x.battle_id = r.id
             and x.user_id in (select user_id from public.battle_players where battle_id = p_battle)) = 2
  ) < 2
  from public.battles b where b.id = p_battle;
$$;

create function public.rematch_json(p_battle uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'server_time', now(),
    'status', coalesce(r.status, 'none'),
    'requested_by_you', r.requester_id = p_user,
    'cancel_reason', r.cancel_reason,
    'new_battle_id', r.new_battle_id,
    'window_ends_at', b.finished_at + interval '60 seconds',
    'rated', public.rematch_is_rated(p_battle),
    'series', public.series_score(
      p_user,
      (select user_id from public.battle_players where battle_id = p_battle and user_id <> p_user)
    )
  )
  from public.battles b
  left join public.rematches r on r.battle_id = b.id
  where b.id = p_battle;
$$;

-- Starts the rematch battle (offer row already locked and still pending).
create function public.start_rematch(p_battle uuid)
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
  insert into public.battles (problem_id, starts_at, ends_at, is_rated, rematch_of)
  values (v_problem, v_starts, v_starts + (v_old.ends_at - v_old.starts_at), v_rated, p_battle)
  returning id into v_battle;

  -- Accepted before the players are added, so the "entering a battle cancels
  -- offers" trigger leaves this one alone.
  update public.rematches set status = 'accepted', responded_at = now(), new_battle_id = v_battle
  where battle_id = p_battle;

  insert into public.battle_players (battle_id, user_id, rating_before)
  select v_battle, p.id, p.rating from public.profiles p where p.id in (v_a, v_b);
  return v_battle;
end;
$$;

-- Entering any battle ends the player's open rematch offers.
create function public.cancel_rematches_on_battle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.rematches r set status = 'cancelled', cancel_reason = 'busy', responded_at = now()
  where r.status = 'pending'
    and r.battle_id <> new.battle_id
    and exists (
      select 1 from public.battle_players bp
      where bp.battle_id = r.battle_id and bp.user_id = new.user_id
    );
  return new;
end;
$$;

create trigger battle_players_cancel_rematches
  after insert on public.battle_players
  for each row execute function public.cancel_rematches_on_battle();

-- ---------------------------------------------------------------------------
-- actions (called by the Worker with the signed-in user's id)
-- ---------------------------------------------------------------------------
create function public.get_rematch(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  perform public.expire_rematches();
  return public.rematch_json(p_battle, p_user);
end;
$$;

-- Ask for a rematch. If the other player already asked, this is a yes.
create function public.request_rematch(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.battles;
  v_other uuid;
  v_offer public.rematches;
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
  if v_battle.status <> 'finished' then
    raise exception 'BATTLE_NOT_ACTIVE';
  end if;
  select user_id into v_other from public.battle_players where battle_id = p_battle and user_id <> p_user;

  -- One decision per battle at a time (both players may press at once).
  perform pg_advisory_xact_lock(hashtext('code_wars.rematch:' || p_battle::text));
  perform public.expire_rematches();
  select * into v_offer from public.rematches where battle_id = p_battle for update;

  if found then
    if v_offer.status = 'accepted' then
      return public.rematch_json(p_battle, p_user);
    end if;
    if v_offer.status = 'declined' then
      raise exception 'REMATCH_DECLINED';
    end if;
    if v_offer.status = 'expired' then
      raise exception 'REMATCH_EXPIRED';
    end if;
    if v_offer.status = 'cancelled' and v_offer.cancel_reason = 'busy' then
      raise exception 'OPPONENT_BUSY';
    end if;
    if v_offer.status = 'pending' and v_offer.requester_id = p_user then
      return public.rematch_json(p_battle, p_user);
    end if;
  end if;

  if now() >= v_battle.finished_at + interval '60 seconds' then
    raise exception 'REMATCH_EXPIRED';
  end if;
  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;
  if public.in_active_battle(v_other) then
    raise exception 'OPPONENT_BUSY';
  end if;

  if v_offer.status = 'pending' then
    -- They asked first: both want it.
    perform public.start_rematch(p_battle);
  elsif v_offer.battle_id is not null then
    -- Asked before and withdrew: ask again.
    update public.rematches set
      requester_id = p_user, status = 'pending', cancel_reason = null,
      created_at = now(), responded_at = null
    where battle_id = p_battle;
  else
    insert into public.rematches (battle_id, requester_id, expires_at)
    values (p_battle, p_user, v_battle.finished_at + interval '60 seconds');
  end if;
  return public.rematch_json(p_battle, p_user);
end;
$$;

-- The other player's answer to a rematch request.
create function public.respond_rematch(p_user uuid, p_battle uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.rematches;
  v_other uuid;
begin
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  perform pg_advisory_xact_lock(hashtext('code_wars.rematch:' || p_battle::text));
  perform public.expire_rematches();
  select * into v_offer from public.rematches where battle_id = p_battle for update;
  if not found or v_offer.requester_id = p_user then
    raise exception 'REMATCH_GONE';
  end if;
  if v_offer.status = 'accepted' then
    return public.rematch_json(p_battle, p_user);
  end if;
  if v_offer.status = 'expired' then
    raise exception 'REMATCH_EXPIRED';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'REMATCH_GONE';
  end if;

  if not p_accept then
    update public.rematches set status = 'declined', responded_at = now() where battle_id = p_battle;
    return public.rematch_json(p_battle, p_user);
  end if;

  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;
  select user_id into v_other from public.battle_players where battle_id = p_battle and user_id <> p_user;
  if public.in_active_battle(v_other) then
    -- Returned rather than raised: an error would undo the cancellation.
    update public.rematches set status = 'cancelled', cancel_reason = 'busy', responded_at = now()
    where battle_id = p_battle;
    return public.rematch_json(p_battle, p_user);
  end if;
  perform public.start_rematch(p_battle);
  return public.rematch_json(p_battle, p_user);
end;
$$;

-- The asker takes it back (also when they leave the result screen).
create function public.cancel_rematch(p_user uuid, p_battle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.battle_players where battle_id = p_battle and user_id = p_user
  ) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  update public.rematches set status = 'cancelled', cancel_reason = 'withdrawn', responded_at = now()
  where battle_id = p_battle and requester_id = p_user and status = 'pending';
  return public.rematch_json(p_battle, p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- battle state: rematch number and series score
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

-- Housekeeping also expires unanswered rematch offers.
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
  perform public.expire_challenges();
  perform public.expire_rematches();
end;
$$;

revoke execute on function
  public.expire_rematches(),
  public.series_score(uuid, uuid),
  public.rematch_is_rated(uuid),
  public.rematch_json(uuid, uuid),
  public.start_rematch(uuid),
  public.cancel_rematches_on_battle(),
  public.get_rematch(uuid, uuid),
  public.request_rematch(uuid, uuid),
  public.respond_rematch(uuid, uuid, boolean),
  public.cancel_rematch(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.expire_rematches(),
  public.series_score(uuid, uuid),
  public.rematch_is_rated(uuid),
  public.rematch_json(uuid, uuid),
  public.start_rematch(uuid),
  public.get_rematch(uuid, uuid),
  public.request_rematch(uuid, uuid),
  public.respond_rematch(uuid, uuid, boolean),
  public.cancel_rematch(uuid, uuid)
to service_role;
