-- Battle read model and participant-checked finalisation, used by the Worker.

-- Everything a player's client needs to render a battle, in one consistent
-- read using database time. The problem is withheld until the battle starts.
-- Also resolves the battle if its time is up, so a stale "active" state is
-- never returned after the deadline.
create function public.get_battle_state(p_user uuid, p_battle uuid)
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

-- Lets a player's client ask for time-up resolution. Has no effect before the
-- deadline or on a finished battle, so calling it repeatedly is harmless.
create function public.request_finalize(p_user uuid, p_battle uuid)
returns boolean
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
  return public.finalize_battle_if_expired(p_battle);
end;
$$;

-- New functions get default privileges; lock them down like the others.
revoke execute on function public.get_battle_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.request_finalize(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_battle_state(uuid, uuid) to service_role;
grant execute on function public.request_finalize(uuid, uuid) to service_role;
