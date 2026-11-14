import { LANGUAGE_LABELS, LIMITS } from "@code-wars/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Panel } from "../components/ui";
import type { HistoryEntry } from "../lib/live";
import { useServices } from "../services";

const RESULT_LABEL = { win: "Win", loss: "Loss", draw: "Draw" } as const;
const RESULT_STYLE = { win: "text-you", loss: "text-rival", draw: "text-ink" } as const;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Rating after each battle, oldest first, as simple bars. */
function RatingChart({ history }: { history: HistoryEntry[] }) {
  const points = [
    history[history.length - 1]!.ratingBefore,
    ...[...history].reverse().map((h) => h.ratingAfter),
  ];
  const shown = points.slice(-30);
  const low = Math.min(...shown);
  const high = Math.max(...shown);
  const span = Math.max(high - low, 1);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Rating history from ${shown[0]} to ${shown[shown.length - 1]}, lowest ${low}, highest ${high}`}
        className="flex h-24 items-end gap-1 border-b border-line-strong"
      >
        {shown.map((value, index) => (
          <div
            key={index}
            className={`min-w-0 flex-1 ${index === shown.length - 1 ? "glow-you bg-you" : "bg-line-strong"}`}
            style={{ height: `${25 + (75 * (value - low)) / span}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-sm text-muted">
        <span>Lowest {low}</span>
        <span>Highest {high}</span>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { user, profile } = useAuth();
  const { data } = useServices();
  const [history, setHistory] = useState<HistoryEntry[] | "loading" | "error">("loading");
  const userId = user!.id;

  useEffect(() => {
    let active = true;
    data.getHistory(userId).then(
      (rows) => active && setHistory(rows),
      () => active && setHistory("error"),
    );
    return () => {
      active = false;
    };
  }, [data, userId]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-[5%] py-10">
      <h1 className="m-0 font-display text-5xl leading-none font-bold tracking-wider uppercase italic">
        Your battles
      </h1>

      <div className="flex flex-wrap items-start gap-6">
        <Panel className="flex min-w-0 flex-1 basis-80 flex-col gap-4 p-6">
          <p className="m-0 text-xs tracking-widest text-muted uppercase">Profile</p>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-3xl font-bold">{profile?.username ?? "Player"}</span>
            <span className="text-glow-you font-display text-4xl font-bold text-you">
              {profile?.rating ?? LIMITS.initialRating}
            </span>
          </div>
          {profile ? (
            <p className="m-0 font-mono text-muted">
              {profile.wins} wins · {profile.losses} losses · {profile.draws} draws
            </p>
          ) : null}
          {Array.isArray(history) && history.length > 0 ? <RatingChart history={history} /> : null}
        </Panel>

        <Panel className="min-w-0 flex-[2] basis-96 p-6">
          <p className="mt-0 mb-3 text-xs tracking-widest text-muted uppercase">Battle history</p>
          {history === "loading" ? (
            <p role="status" className="m-0 text-muted">
              Loading your battles…
            </p>
          ) : history === "error" ? (
            <p role="alert" className="m-0 text-rival">
              Could not load your battles. Try again in a moment.
            </p>
          ) : history.length === 0 ? (
            <p className="m-0 text-soft">
              No battles yet.{" "}
              <Link to="/arena" className="text-you">
                Find your first one
              </Link>
              .
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {history.map((entry) => {
                const delta = entry.ratingAfter - entry.ratingBefore;
                return (
                  <li key={entry.battleId} className="border-t border-line">
                    <Link
                      to={`/battle/${entry.battleId}`}
                      className="flex min-h-11 flex-col gap-0.5 py-3 text-ink no-underline hover:bg-you/5"
                    >
                      <span className="flex justify-between gap-3">
                        <span>
                          <span
                            className={`font-display font-bold uppercase ${RESULT_STYLE[entry.result]}`}
                          >
                            {RESULT_LABEL[entry.result]}
                          </span>{" "}
                          vs {entry.opponent}
                        </span>
                        <span className={`font-mono ${delta >= 0 ? "text-you" : "text-rival"}`}>
                          {delta >= 0 ? "+" : "−"}
                          {Math.abs(delta)}
                        </span>
                      </span>
                      <span className="text-sm text-muted">
                        {[
                          entry.problemTitle,
                          entry.language ? LANGUAGE_LABELS[entry.language] : null,
                          formatDate(entry.finishedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}
