import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { EditorPanel } from "../battle/EditorPanel";
import { ProblemPanel } from "../battle/ProblemPanel";
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
  const { user, refreshProfile } = useAuth();
  const { api } = useServices();
  const battle = useBattle(id, user!.id);
  const [confirmingForfeit, setConfirmingForfeit] = useState(false);
  const [forfeitError, setForfeitError] = useState<string | null>(null);

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
  if (finished) return <ResultView state={state} />;

  const you = state.players.find((p) => p.isYou)!;
  const rival = state.players.find((p) => !p.isYou)!;

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
      />

      <div className="flex min-h-12 flex-wrap items-center justify-end gap-3 border-b border-line bg-panel-deep px-6 py-1.5">
        {forfeitError ? (
          <span role="alert" className="mr-auto text-sm text-rival">
            {forfeitError}
          </span>
        ) : null}
        {confirmingForfeit ? (
          <>
            <span className="text-sm text-soft">Forfeit and lose rating?</span>
            <Button variant="ghost" className="h-11 px-4" onClick={() => void forfeit()}>
              Yes, forfeit
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
            Forfeit
          </Button>
        )}
      </div>

      {battle.phase === "ready" || !state.problem ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <p className="m-0 font-mono text-sm tracking-[0.2em] text-rival uppercase">
            Opponent found
          </p>
          <h1 className="m-0 font-display text-5xl font-bold uppercase italic">
            {you.username} <span className="text-muted">vs</span>{" "}
            <span className="text-rival">{rival.username}</span>
          </h1>
          <p className="text-glow-you m-0 font-display text-8xl font-bold text-you">
            {formatClock(battle.remainingMs)}
          </p>
          <p className="m-0 text-soft">Get ready. The problem appears when the countdown ends.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap items-stretch">
          <div className="min-w-0 flex-1 basis-[420px] border-r border-line">
            <ProblemPanel problem={state.problem} />
          </div>
          <div className="flex min-w-0 flex-[999] basis-[520px] flex-col">
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
