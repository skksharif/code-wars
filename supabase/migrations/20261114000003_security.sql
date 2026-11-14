-- Code Wars security: RLS, table grants, function grants, Realtime.
--
-- Model: clients (anon, authenticated) can only SELECT, and only what the
-- policies below allow. Every write goes through the Worker using the service
-- role and the functions in 20261114000002_functions.sql.

alter table public.profiles enable row level security;
alter table public.problems enable row level security;
alter table public.problem_tests enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.battles enable row level security;
alter table public.battle_players enable row level security;
alter table public.submissions enable row level security;
alter table public.judge_usage enable row level security;

-- ---------------------------------------------------------------------------
-- table privileges (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.leaderboard to anon, authenticated;
grant select on
  public.problems,
  public.battles,
  public.battle_players,
  public.submissions,
  public.rating_history
to authenticated;
-- problem_tests, matchmaking_queue and judge_usage: no client privileges at all.

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- policies (SELECT only; there are deliberately no write policies)
-- ---------------------------------------------------------------------------
create policy "profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "participants can read their battles"
  on public.battles for select
  to authenticated
  using (public.is_battle_participant(id));

-- Includes the opponent's row: attempts, best_passed, language, result.
create policy "participants can read battle players"
  on public.battle_players for select
  to authenticated
  using (public.is_battle_participant(battle_id));

-- A problem becomes readable only once a battle the user is in has started,
-- so the problem pool cannot be studied in advance.
create policy "participants can read the problem after the battle starts"
  on public.problems for select
  to authenticated
  using (
    exists (
      select 1 from public.battles b
      where b.problem_id = problems.id
        and b.starts_at <= now()
        and public.is_battle_participant(b.id)
    )
  );

-- Own submissions always. The opponent's submitted code only after the battle
-- has finished (approved decision A9); Run attempts stay private.
create policy "players read own submissions and opponent's after the battle"
  on public.submissions for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      kind = 'submit'
      and public.is_battle_participant(battle_id)
      and exists (
        select 1 from public.battles b
        where b.id = submissions.battle_id and b.status = 'finished'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.is_battle_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (only present on a real Supabase project; skipped elsewhere)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.battles, public.battle_players;
  end if;

  -- Private presence channel "battle:<battle id>" for participants only.
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "battle participants can join the battle channel"
        on realtime.messages for select
        to authenticated
        using (
          realtime.topic() ~ '^battle:[0-9a-f-]{36}$'
          and public.is_battle_participant(split_part(realtime.topic(), ':', 2)::uuid)
        )
    $policy$;
    execute $policy$
      create policy "battle participants can track presence"
        on realtime.messages for insert
        to authenticated
        with check (
          realtime.topic() ~ '^battle:[0-9a-f-]{36}$'
          and public.is_battle_participant(split_part(realtime.topic(), ':', 2)::uuid)
        )
    $policy$;
  end if;
end;
$$;
