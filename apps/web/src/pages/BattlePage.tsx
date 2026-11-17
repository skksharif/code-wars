import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { EditorPanel } from "../battle/EditorPanel";
import { ProblemPanel } from "../battle/ProblemPanel";
import { OvertimeOffer } from "../battle/OvertimeOffer";
import { ResultView } from "../battle/ResultView";
import { formatClock, useBattle } from "../battle/useBattle";
import { VersusBar } from "../battle/VersusBar";
import { Button } from "../components/ui";
import { ApiError } from "../lib/api";
import { useServices } from "../services";

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <h1 className="m-0 font-display text-4xl font-bold uppercase italic">{title}</h1>
      {children}
      <Link to="/arena" className="text-you">
        Back to the arena
      </Link>
    </main>
  );
}

export function BattlePage() {
  const { id = "" } = useParams();
  // A new battle id (for example a rematch) starts the room afresh.
  return <BattleRoom key={id} id={id} />;
}

function BattleRoom({ id }: { id: string }) {
  const { user, refreshProfile } = useAuth();
  const { api } = useServices();
  const battle = useBattle(id, user!.id);
  const [confirmingForfeit, setConfirmingForfeit] = useState(false);
  const [forfeitError, setForfeitError] = useState<string | null>(null);
  // Below the large breakpoint the problem and the editor do not fit side by
  // side, so they become two tabs. Both stay mounted so nothing is lost.
  const [pane, setPane] = useState<"problem" | "code">("problem");
  // Overtime offer: answered with "Keep coding", or giving up in progress.
  const [keepCoding, setKeepCoding] = useState(false);
  const [givingUp, setGivingUp] = useState(false);

  const finished = battle.phase === "finished";
  useEffect(() => {
    // Ratings changed: update the number shown in the navigation.
    if (finished) void refreshProfile();
  }, [finished, refreshProfile]);

  if (battle.error) {
    const text =
      battle.error.code === "NOT_PARTICIPANT"
        ? "You are not a player in this battle."
        : battle.error.code === "NOT_FOUND" || battle.error.code === "INVALID_INPUT"
          ? "This battle does not exist."
          : battle.error.message;
    return (
      <Message title="Battle unavailable">
        <p role="alert" className="m-0 text-rival">
          {text}
        </p>
      </Message>
    );
  }
  if (!battle.state) {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Loading battle…
      </p>
    );
  }

  const { state } = battle;
  const you = state.players.find((p) => p.isYou)!;
  const rival = state.players.find((p) => !p.isYou)!;
  if (finished) {
    return (
      <ResultView
        state={state}
        overtimeLeftMs={battle.overtimeLeftMs}
        rivalHere={battle.onlineUserIds ? battle.onlineUserIds.includes(rival.userId) : null}
      />
    );
  }

  // Giving up in overtime: the player chose it on the offer, so no second question.
  async function giveUp() {
    setGivingUp(true);
    setForfeitError(null);
    try {
      await api.forfeit(id);
      await battle.refresh();
    } catch (caught) {
      setForfeitError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setGivingUp(false);
    }
  }

  async function forfeit() {
    setForfeitError(null);
    try {
      await api.forfeit(id);
      await battle.refresh();
    } catch (caught) {
      setForfeitError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setConfirmingForfeit(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col">
      <VersusBar
        you={you}
        rival={rival}
        totalTests={state.totalTests}
        phase={battle.phase}
        remainingMs={battle.remainingMs}
        rivalOnline={battle.onlineUserIds ? battle.onlineUserIds.includes(rival.userId) : null}
        overtime={battle.overtime}
      />

      {battle.overtime && battle.phase === "active" ? (
        <OvertimeOffer
          rival={rival.username}
          rivalSolveMs={
            Date.parse(state.battle.firstSolvedAt ?? state.battle.startsAt) -
            Date.parse(state.battle.startsAt)
          }
          passed={you.bestPassed}
          total={state.totalTests}
          fullDelta={state.battle.overtimeFullDelta ?? 0}
          rated={state.battle.isRated}
          leftMs={battle.overtimeLeftMs}
          answered={keepCoding}
          busy={givingUp}
          onKeepCoding={() => setKeepCoding(true)}
          onGiveUp={() => void giveUp()}
        />
      ) : null}

      <div className="flex min-h-12 flex-wrap items-center justify-end gap-2 border-b border-line bg-panel-deep px-3 py-1.5 md:gap-3 md:px-6">
        {battle.phase !== "ready" && state.problem && !confirmingForfeit ? (
          <div role="tablist" aria-label="Show" className="mr-auto flex lg:hidden">
            {(["problem", "code"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={pane === key}
                onClick={() => setPane(key)}
                className={`h-11 cursor-pointer border-0 border-b-2 bg-transparent px-4 font-display font-semibold tracking-widest uppercase ${
                  pane === key ? "border-you text-you" : "border-transparent text-muted"
                }`}
              >
                {key === "problem" ? "Problem" : "Code"}
              </button>
            ))}
          </div>
        ) : null}
        {forfeitError ? (
          <span role="alert" className="mr-auto text-sm text-rival">
            {forfeitError}
          </span>
        ) : null}
        {confirmingForfeit ? (
          <>
            <span className="text-sm text-soft">
              {battle.overtime ? "Give up and take the full loss?" : "Forfeit and lose rating?"}
            </span>
            <Button variant="ghost" className="h-11 px-4" onClick={() => void forfeit()}>
              {battle.overtime ? "Yes, give up" : "Yes, forfeit"}
            </Button>
            <Button
              variant="outline"
              className="h-11 px-4"
              onClick={() => setConfirmingForfeit(false)}
            >
              Keep fighting
            </Button>
          </>
        ) : (
          <Button variant="ghost" className="h-11 px-4" onClick={() => setConfirmingForfeit(true)}>
            {battle.overtime ? "Give up" : "Forfeit"}
          </Button>
        )}
      </div>

      {battle.phase === "ready" || !state.problem ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center md:p-10">
          {state.battle.rematchOf ? (
            <p className="m-0 border border-rival px-3 py-1 font-mono text-sm tracking-[0.2em] text-rival uppercase">
              Rematch · game{" "}
              {state.battle.series.you + state.battle.series.them + state.battle.series.draws + 1}
            </p>
          ) : (
            <p className="m-0 font-mono text-sm tracking-[0.2em] text-rival uppercase">
              Opponent found
            </p>
          )}
          <h1 className="m-0 font-display text-3xl font-bold break-words uppercase italic md:text-5xl">
            {you.username} <span className="text-muted">vs</span>{" "}
            <span className="text-rival">{rival.username}</span>
          </h1>
          <p className="text-glow-you m-0 font-display text-7xl font-bold text-you md:text-8xl">
            {formatClock(battle.remainingMs)}
          </p>
          {state.battle.rematchOf ? (
            <p
              className="m-0 flex flex-col items-center border border-line bg-panel px-6 py-2"
              aria-label={`Series tonight: you ${state.battle.series.you}, ${rival.username} ${state.battle.series.them}`}
            >
              <span className="text-xs tracking-[0.14em] text-muted uppercase">Series tonight</span>
              <span className="font-display text-3xl font-bold">
                <span className="text-you">{state.battle.series.you}</span>{" "}
                <span className="text-muted">–</span>{" "}
                <span className="text-rival">{state.battle.series.them}</span>
              </span>
            </p>
          ) : null}
          <p className="m-0 text-soft">Get ready. The problem appears when the countdown ends.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap items-stretch">
          <div
            className={`${pane === "problem" ? "block" : "hidden"} min-w-0 flex-1 basis-full border-line lg:block lg:basis-[420px] lg:border-r`}
          >
            <ProblemPanel problem={state.problem} />
            <div className="px-4 pb-6 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setPane("code");
                  window.scrollTo({ top: 0 });
                }}
                className="cut glow-you h-12 w-full cursor-pointer border-0 bg-you font-display font-bold tracking-widest text-ground uppercase"
              >
                Start coding
              </button>
            </div>
          </div>
          <div
            className={`${pane === "code" ? "flex" : "hidden"} min-w-0 flex-[999] basis-full flex-col lg:flex lg:basis-[520px]`}
          >
            {battle.phase === "expired" ? (
              <p role="status" className="m-0 border-b border-line p-3 text-center text-soft">
                Time is up. Working out the result…
              </p>
            ) : null}
            <EditorPanel
              battleId={id}
              enabled={battle.phase === "active"}
              onSubmitted={() => void battle.refresh()}
            />
          </div>
        </div>
      )}
    </main>
  );
}
