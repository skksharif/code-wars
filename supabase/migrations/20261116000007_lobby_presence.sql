-- Players online: every signed-in player joins the private Realtime channel
-- "lobby" and tracks presence there (one key per user, so several tabs count
-- once). The arena shows how many are connected.
--
-- Only presence is allowed on this channel, never broadcast, so it cannot be
-- used to send messages to everyone. Anonymous visitors cannot join.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "signed-in players can join the lobby channel"
        on realtime.messages for select
        to authenticated
        using (
          (select realtime.topic()) = 'lobby'
          and realtime.messages.extension = 'presence'
        )
    $policy$;
    execute $policy$
      create policy "signed-in players can track presence in the lobby"
        on realtime.messages for insert
        to authenticated
        with check (
          (select realtime.topic()) = 'lobby'
          and realtime.messages.extension = 'presence'
        )
    $policy$;
  end if;
end;
$$;
