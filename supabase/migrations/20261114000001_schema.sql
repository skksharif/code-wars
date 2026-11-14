-- Code Wars schema: tables, constraints, indexes.
-- RLS and grants are in 20261114000003_security.sql. Functions are in 20261114000002_functions.sql.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  rating integer not null default 1200,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  created_at timestamptz not null default now()
);

-- Usernames are unique regardless of case.
create unique index profiles_username_lower_key on public.profiles (lower(username));
create index profiles_rating_idx on public.profiles (rating desc);

-- ---------------------------------------------------------------------------
-- problems and hidden tests
-- ---------------------------------------------------------------------------
create table public.problems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  statement_md text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  -- Array of {input, output, explanation?}. Shown to players and used by Run.
  samples jsonb not null default '[]'::jsonb check (jsonb_typeof(samples) = 'array'),
  time_limit_ms integer not null default 2000 check (time_limit_ms between 100 and 10000),
  memory_limit_kb integer not null default 128000 check (memory_limit_kb between 16000 and 512000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Hidden tests. Never readable by clients.
create table public.problem_tests (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  input text not null,
  expected_output text not null,
  unique (problem_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- matchmaking queue
-- ---------------------------------------------------------------------------
create table public.matchmaking_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  rating integer not null,
  joined_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

create index matchmaking_queue_rating_idx on public.matchmaking_queue (rating);

-- ---------------------------------------------------------------------------
-- battles
-- ---------------------------------------------------------------------------
create table public.battles (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id),
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  finished_at timestamptz,
  winner_id uuid references public.profiles (id) on delete set null,
  finish_reason text check (
    finish_reason in ('solved', 'timeout_score', 'timeout_draw', 'forfeit')
  ),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index battles_status_ends_at_idx on public.battles (status, ends_at);

create table public.battle_players (
  battle_id uuid not null references public.battles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_active boolean not null default true,
  language text check (language in ('python', 'java', 'cpp', 'javascript')),
  attempts integer not null default 0 check (attempts >= 0),
  best_passed integer not null default 0 check (best_passed >= 0),
  best_passed_at timestamptz,
  rating_before integer not null,
  rating_after integer,
  result text check (result in ('win', 'loss', 'draw')),
  primary key (battle_id, user_id)
);

-- A user can be in at most one active battle. This is the last line of defence
-- against duplicate matches even if application logic is wrong.
create unique index battle_players_one_active_per_user
  on public.battle_players (user_id)
  where is_active;

create index battle_players_user_idx on public.battle_players (user_id, battle_id);

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('run', 'submit')),
  language text not null check (language in ('python', 'java', 'cpp', 'javascript')),
  source_code text not null check (octet_length(source_code) between 1 and 65536),
  status text not null default 'judging' check (status in ('judging', 'done', 'error')),
  verdict text check (
    verdict in (
      'accepted', 'wrong_answer', 'compile_error', 'runtime_error',
      'time_limit', 'memory_limit', 'internal_error'
    )
  ),
  passed integer not null default 0 check (passed >= 0),
  total integer not null check (total >= 0),
  reserved_executions integer not null default 0 check (reserved_executions >= 0),
  compile_output text,
  created_at timestamptz not null default now(),
  judged_at timestamptz,
  check (passed <= total)
);

-- At most one submission being judged per user.
create unique index submissions_one_judging_per_user
  on public.submissions (user_id)
  where status = 'judging';

create index submissions_battle_user_idx
  on public.submissions (battle_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- judge quota accounting (UTC day)
-- ---------------------------------------------------------------------------
create table public.judge_usage (
  day date primary key,
  executions integer not null default 0 check (executions >= 0)
);

-- ---------------------------------------------------------------------------
-- views
-- ---------------------------------------------------------------------------
create view public.leaderboard
with (security_invoker = true) as
select
  p.id,
  p.username,
  p.rating,
  p.wins,
  p.losses,
  p.draws,
  rank() over (order by p.rating desc) as rank
from public.profiles p;

-- Rating history is derived from finished battles so it can never drift from
-- the ratings that were actually applied.
create view public.rating_history
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
  and bp.rating_after is not null;
