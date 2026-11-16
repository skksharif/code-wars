-- Friends and friend challenges (approved 2026-11-16, decision D18).
--
--   * Friend requests by username or from a profile; the other player must
--     accept. Up to 100 friends and 20 unanswered outgoing requests. A declined
--     request cannot be sent again to the same player for 24 hours.
--   * Challenge a friend: they get 30 seconds to accept; on accept an unrated
--     battle starts at once (10-second get-ready, as everywhere).
--   * A player in a battle is busy: they cannot be challenged and cannot
--     challenge. Entering any battle cancels their pending challenges.
--   * Head-to-head record between two players over all finished battles.
--
-- Clients only read (RLS); every change goes through the Worker and the
-- functions below, which are callable by service_role only.

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- One row per pair of players, whichever of them asked.
create unique index friendships_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  challenged_id uuid not null references public.profiles (id) on delete cascade,
  difficulty text not null default 'any' check (difficulty in ('any', 'easy', 'medium', 'hard')),
  duration_minutes integer not null default 15 check (duration_minutes in (10, 15, 30)),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  -- Why a challenge was cancelled: withdrawn, or a player started another battle.
  cancel_reason text check (cancel_reason in ('withdrawn', 'challenger_busy', 'challenged_busy', 'unfriended')),
  battle_id uuid references public.battles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  check (challenger_id <> challenged_id)
);

-- A player has at most one outgoing challenge waiting for an answer.
create unique index challenges_one_pending_per_challenger
  on public.challenges (challenger_id) where status = 'pending';
create index challenges_challenged_idx on public.challenges (challenged_id, status);
create index challenges_challenger_idx on public.challenges (challenger_id, created_at desc);

alter table public.friendships enable row level security;
alter table public.challenges enable row level security;
revoke all on public.friendships, public.challenges from anon, authenticated;
grant select on public.friendships, public.challenges to authenticated;
grant all on public.friendships, public.challenges to service_role;

-- Only the two players involved can read a request, friendship or challenge
-- (also what Realtime delivers).
create policy "players read their own friendships"
  on public.friendships for select
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "players read their own challenges"
  on public.challenges for select
  to authenticated
  using (challenger_id = auth.uid() or challenged_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.friendships, public.challenges;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- helpers (internal)
-- ---------------------------------------------------------------------------
create function public.expire_challenges()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.challenges set status = 'expired', responded_at = now()
  where status = 'pending' and expires_at <= now();
$$;

create function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and least(requester_id, addressee_id) = least(p_a, p_b)
      and greatest(requester_id, addressee_id) = greatest(p_a, p_b)
  );
$$;

-- p_a's record against p_b over every finished battle between them.
create function public.head_to_head(p_a uuid, p_b uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'wins', count(*) filter (where mine.result = 'win'),
    'losses', count(*) filter (where mine.result = 'loss'),
    'draws', count(*) filter (where mine.result = 'draw')
  )
  from public.battle_players mine
  join public.battle_players theirs
    on theirs.battle_id = mine.battle_id and theirs.user_id = p_b
  join public.battles b on b.id = mine.battle_id
  where mine.user_id = p_a and b.status = 'finished';
$$;

-- A problem of the given difficulty (any: all), preferring ones neither player has had.
create function public.pick_problem(p_difficulty text, p_a uuid, p_b uuid)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.problems p
  where p.is_active
    and (p_difficulty = 'any' or p.difficulty = p_difficulty)
    and exists (select 1 from public.problem_tests t where t.problem_id = p.id)
  order by
    (
      select count(*) from public.battles b
      join public.battle_players bp on bp.battle_id = b.id
      where b.problem_id = p.id and bp.user_id in (p_a, p_b)
    ),
    random()
  limit 1;
$$;

create function public.player_json(p_user uuid)
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

create function public.challenge_json(p_challenge uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'server_time', now(),
    'id', c.id,
    'status', c.status,
    'cancel_reason', c.cancel_reason,
    'difficulty', c.difficulty,
    'duration_minutes', c.duration_minutes,
    'expires_at', c.expires_at,
    'battle_id', c.battle_id,
    'is_challenger', c.challenger_id = p_user,
    'challenger', public.player_json(c.challenger_id),
    'challenged', public.player_json(c.challenged_id)
  )
  from public.challenges c where c.id = p_challenge;
$$;

-- Entering any battle cancels the player's pending challenges, sent or received.
create function public.cancel_challenges_on_battle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.challenges set
    status = 'cancelled',
    responded_at = now(),
    cancel_reason = case when challenger_id = new.user_id then 'challenger_busy' else 'challenged_busy' end
  where status = 'pending' and (challenger_id = new.user_id or challenged_id = new.user_id);
  return new;
end;
$$;

create trigger battle_players_cancel_challenges
  after insert on public.battle_players
  for each row execute function public.cancel_challenges_on_battle();

-- ---------------------------------------------------------------------------
-- friends
-- ---------------------------------------------------------------------------
create function public.send_friend_request(p_user uuid, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_row public.friendships;
begin
  select id into v_target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_target is null then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_target = p_user then
    raise exception 'FRIEND_SELF';
  end if;

  -- One decision per pair at a time.
  perform pg_advisory_xact_lock(hashtext('code_wars.pair:' || least(p_user, v_target)::text || greatest(p_user, v_target)::text));

  select * into v_row from public.friendships
  where least(requester_id, addressee_id) = least(p_user, v_target)
    and greatest(requester_id, addressee_id) = greatest(p_user, v_target)
  for update;

  if found then
    if v_row.status = 'accepted' then
      raise exception 'ALREADY_FRIENDS';
    end if;
    if v_row.status = 'pending' and v_row.requester_id = p_user then
      return jsonb_build_object('status', 'outgoing', 'user_id', v_target);
    end if;
    if v_row.status = 'pending' and v_row.addressee_id = p_user then
      -- They already asked you: asking back accepts.
      return public.respond_friend_request(p_user, v_target, true);
    end if;
    -- Declined earlier.
    if v_row.requester_id = p_user and v_row.responded_at > now() - interval '24 hours' then
      raise exception 'REQUEST_DECLINED';
    end if;
  end if;

  if (select count(*) from public.friendships
      where (requester_id = p_user or addressee_id = p_user) and status = 'accepted') >= 100
    or (select count(*) from public.friendships
        where (requester_id = v_target or addressee_id = v_target) and status = 'accepted') >= 100 then
    raise exception 'FRIEND_LIMIT';
  end if;
  if (select count(*) from public.friendships where requester_id = p_user and status = 'pending') >= 20 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;

  if v_row.id is not null then
    update public.friendships set
      requester_id = p_user, addressee_id = v_target, status = 'pending',
      created_at = now(), responded_at = null
    where id = v_row.id;
  else
    insert into public.friendships (requester_id, addressee_id) values (p_user, v_target);
  end if;
  return jsonb_build_object('status', 'outgoing', 'user_id', v_target);
end;
$$;

create function public.respond_friend_request(p_user uuid, p_requester uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.friendships;
begin
  select * into v_row from public.friendships
  where requester_id = p_requester and addressee_id = p_user and status = 'pending'
  for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if p_accept and (
    (select count(*) from public.friendships
     where (requester_id = p_user or addressee_id = p_user) and status = 'accepted') >= 100
    or (select count(*) from public.friendships
        where (requester_id = p_requester or addressee_id = p_requester) and status = 'accepted') >= 100
  ) then
    raise exception 'FRIEND_LIMIT';
  end if;
  update public.friendships set
    status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now()
  where id = v_row.id;
  return jsonb_build_object(
    'status', case when p_accept then 'friends' else 'none' end,
    'user_id', p_requester
  );
end;
$$;

-- Unfriend, or withdraw a request you sent. Pending challenges between the two end too.
create function public.remove_friend(p_user uuid, p_other uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.friendships
  where least(requester_id, addressee_id) = least(p_user, p_other)
    and greatest(requester_id, addressee_id) = greatest(p_user, p_other)
    and (status = 'accepted' or (status = 'pending' and requester_id = p_user));
  update public.challenges set status = 'cancelled', cancel_reason = 'unfriended', responded_at = now()
  where status = 'pending'
    and ((challenger_id = p_user and challenged_id = p_other)
      or (challenger_id = p_other and challenged_id = p_user));
  return jsonb_build_object('status', 'none', 'user_id', p_other);
end;
$$;

-- Your friends (with busy state and head-to-head) and pending requests both ways.
create function public.get_friends(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(
        public.player_json(other.id) || jsonb_build_object(
          'friends_since', f.responded_at,
          'in_battle', exists (
            select 1 from public.battle_players bp where bp.user_id = other.id and bp.is_active
          ),
          'head_to_head', public.head_to_head(p_user, other.id)
        )
        order by lower(other.username)
      )
      from public.friendships f
      join public.profiles other
        on other.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
      where f.status = 'accepted' and (f.requester_id = p_user or f.addressee_id = p_user)
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(public.player_json(f.requester_id) || jsonb_build_object('sent_at', f.created_at)
                       order by f.created_at desc)
      from public.friendships f
      where f.addressee_id = p_user and f.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(public.player_json(f.addressee_id) || jsonb_build_object('sent_at', f.created_at)
                       order by f.created_at desc)
      from public.friendships f
      where f.requester_id = p_user and f.status = 'pending'
    ), '[]'::jsonb)
  );
$$;

-- How you stand with one player, for the button on their profile.
create function public.get_friend_status(p_user uuid, p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_other uuid;
  v_row public.friendships;
begin
  select id into v_other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_other is null then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_other = p_user then
    return jsonb_build_object('status', 'self', 'user_id', v_other);
  end if;
  select * into v_row from public.friendships
  where least(requester_id, addressee_id) = least(p_user, v_other)
    and greatest(requester_id, addressee_id) = greatest(p_user, v_other);
  return jsonb_build_object(
    'user_id', v_other,
    'status', case
      when v_row.status = 'accepted' then 'friends'
      when v_row.status = 'pending' and v_row.requester_id = p_user then 'outgoing'
      when v_row.status = 'pending' then 'incoming'
      else 'none'
    end,
    'in_battle', exists (
      select 1 from public.battle_players bp where bp.user_id = v_other and bp.is_active
    ),
    'head_to_head', public.head_to_head(p_user, v_other)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- challenges
-- ---------------------------------------------------------------------------
-- Starts the unrated battle for an accepted challenge (row already locked).
create function public.start_challenge_battle(p_challenge uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.challenges;
  v_problem uuid;
  v_battle uuid;
  v_starts timestamptz;
begin
  select * into v_c from public.challenges where id = p_challenge;
  v_problem := public.pick_problem(v_c.difficulty, v_c.challenger_id, v_c.challenged_id);
  if v_problem is null then
    raise exception 'NO_PROBLEMS_AVAILABLE';
  end if;

  -- Out of any queue or open room first.
  delete from public.matchmaking_queue where user_id in (v_c.challenger_id, v_c.challenged_id);
  perform public.leave_open_rooms(v_c.challenger_id);
  perform public.leave_open_rooms(v_c.challenged_id);

  v_starts := now() + interval '10 seconds';
  insert into public.battles (problem_id, starts_at, ends_at, is_rated)
  values (v_problem, v_starts, v_starts + make_interval(mins => v_c.duration_minutes), false)
  returning id into v_battle;

  -- Mark it accepted before the players are added, so the trigger that cancels
  -- pending challenges on entering a battle leaves this one alone.
  update public.challenges set status = 'accepted', responded_at = now(), battle_id = v_battle
  where id = p_challenge;

  insert into public.battle_players (battle_id, user_id, rating_before)
  select v_battle, p.id, p.rating from public.profiles p
  where p.id in (v_c.challenger_id, v_c.challenged_id);
  return v_battle;
end;
$$;

create function public.send_challenge(
  p_user uuid,
  p_friend uuid,
  p_difficulty text,
  p_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_crossed uuid;
  v_id uuid;
begin
  if p_difficulty is null or p_difficulty not in ('any', 'easy', 'medium', 'hard')
    or p_minutes is null or p_minutes not in (10, 15, 30) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_friend = p_user then
    raise exception 'FRIEND_SELF';
  end if;
  perform pg_advisory_xact_lock(hashtext('code_wars.pair:' || least(p_user, p_friend)::text || greatest(p_user, p_friend)::text));
  perform public.expire_challenges();

  if not public.are_friends(p_user, p_friend) then
    raise exception 'NOT_FRIENDS';
  end if;
  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;
  if public.in_active_battle(p_friend) then
    raise exception 'FRIEND_BUSY';
  end if;

  -- They challenged you at the same moment: that counts as both accepting.
  select id into v_crossed from public.challenges
  where status = 'pending' and challenger_id = p_friend and challenged_id = p_user
  for update;
  if v_crossed is not null then
    perform public.start_challenge_battle(v_crossed);
    return public.challenge_json(v_crossed, p_user);
  end if;

  -- A new challenge replaces your previous unanswered one.
  update public.challenges set status = 'cancelled', cancel_reason = 'withdrawn', responded_at = now()
  where challenger_id = p_user and status = 'pending';

  insert into public.challenges (challenger_id, challenged_id, difficulty, duration_minutes, expires_at)
  values (p_user, p_friend, p_difficulty, p_minutes, now() + interval '30 seconds')
  returning id into v_id;
  return public.challenge_json(v_id, p_user);
end;
$$;

create function public.respond_challenge(p_user uuid, p_challenge uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.challenges;
begin
  perform public.expire_challenges();
  select * into v_c from public.challenges where id = p_challenge for update;
  if not found then
    raise exception 'CHALLENGE_GONE';
  end if;
  if v_c.challenged_id <> p_user then
    raise exception 'NOT_PARTICIPANT';
  end if;
  if v_c.status = 'accepted' and p_accept then
    return public.challenge_json(p_challenge, p_user);
  end if;
  if v_c.status = 'expired' then
    raise exception 'CHALLENGE_EXPIRED';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'CHALLENGE_GONE';
  end if;

  if not p_accept then
    update public.challenges set status = 'declined', responded_at = now() where id = p_challenge;
    return public.challenge_json(p_challenge, p_user);
  end if;

  if public.in_active_battle(p_user) then
    raise exception 'ALREADY_IN_BATTLE';
  end if;
  if public.in_active_battle(v_c.challenger_id) then
    -- Returned rather than raised: an error would undo the cancellation.
    update public.challenges set status = 'cancelled', cancel_reason = 'challenger_busy', responded_at = now()
    where id = p_challenge;
    return public.challenge_json(p_challenge, p_user);
  end if;

  perform public.start_challenge_battle(p_challenge);
  return public.challenge_json(p_challenge, p_user);
end;
$$;

create function public.cancel_challenge(p_user uuid, p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.challenges where id = p_challenge and challenger_id = p_user) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  update public.challenges set status = 'cancelled', cancel_reason = 'withdrawn', responded_at = now()
  where id = p_challenge and status = 'pending';
  return public.challenge_json(p_challenge, p_user);
end;
$$;

-- Everything the bell and the challenge pop-ups need, in one call.
create function public.get_notifications(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outgoing uuid;
begin
  perform public.expire_challenges();
  -- Your latest challenge: pending, or answered in the last minute (to show the answer).
  select id into v_outgoing from public.challenges
  where challenger_id = p_user
    and (status = 'pending' or responded_at > now() - interval '1 minute')
  order by created_at desc limit 1;

  return jsonb_build_object(
    'server_time', now(),
    'friend_requests', (
      select count(*) from public.friendships where addressee_id = p_user and status = 'pending'
    ),
    'incoming_challenges', coalesce((
      select jsonb_agg(public.challenge_json(c.id, p_user) order by c.created_at)
      from public.challenges c
      where c.challenged_id = p_user and c.status = 'pending'
    ), '[]'::jsonb),
    'outgoing_challenge', case when v_outgoing is null then null
      else public.challenge_json(v_outgoing, p_user) end
  );
end;
$$;

-- Housekeeping also expires unanswered challenges.
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
end;
$$;

-- ---------------------------------------------------------------------------
-- function privileges: the Worker only
-- ---------------------------------------------------------------------------
revoke execute on function
  public.expire_challenges(),
  public.are_friends(uuid, uuid),
  public.head_to_head(uuid, uuid),
  public.pick_problem(text, uuid, uuid),
  public.player_json(uuid),
  public.challenge_json(uuid, uuid),
  public.cancel_challenges_on_battle(),
  public.send_friend_request(uuid, text),
  public.respond_friend_request(uuid, uuid, boolean),
  public.remove_friend(uuid, uuid),
  public.get_friends(uuid),
  public.get_friend_status(uuid, text),
  public.start_challenge_battle(uuid),
  public.send_challenge(uuid, uuid, text, integer),
  public.respond_challenge(uuid, uuid, boolean),
  public.cancel_challenge(uuid, uuid),
  public.get_notifications(uuid)
from public, anon, authenticated;

grant execute on function
  public.expire_challenges(),
  public.are_friends(uuid, uuid),
  public.head_to_head(uuid, uuid),
  public.pick_problem(text, uuid, uuid),
  public.player_json(uuid),
  public.challenge_json(uuid, uuid),
  public.send_friend_request(uuid, text),
  public.respond_friend_request(uuid, uuid, boolean),
  public.remove_friend(uuid, uuid),
  public.get_friends(uuid),
  public.get_friend_status(uuid, text),
  public.start_challenge_battle(uuid),
  public.send_challenge(uuid, uuid, text, integer),
  public.respond_challenge(uuid, uuid, boolean),
  public.cancel_challenge(uuid, uuid),
  public.get_notifications(uuid)
to service_role;
