import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { BlitzMark } from "../components/BlitzMark";
import { BRAND_NAME, Wordmark } from "../components/Brand";
import { LoginForm } from "../components/LoginForm";
import { SignUpForm } from "../components/SignUpForm";
import type { LeaderboardEntry } from "../lib/live";
import { useServices } from "../services";

const PLACE_COLOURS = ["text-gold", "text-soft", "text-[#D08A4E]"];

/** The current top three, with an invitation when the board is empty. */
function TopThree() {
  const { data } = useServices();
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  useEffect(() => {
    let active = true;
    data.getLeaderboard(3).then(
      (r) => active && setRows(r),
      () => active && setRows(null),
    );
    return () => {
      active = false;
    };
  }, [data]);
  if (rows === null) return null;
  return (
    <section aria-label="Top players" className="border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="m-0 font-display text-sm font-bold tracking-[0.2em] uppercase">Top 3</h2>
        <Link to="/rankings" className="text-sm text-you">
          All rankings
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 px-4 py-4 text-soft">
          The board is empty. Win the first ranked battle and take <b className="text-gold">#1</b>.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {rows.map((row, i) => (
            <li
              key={row.id}
              className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0"
            >
              <span className={`w-5 font-display text-lg font-bold ${PLACE_COLOURS[i] ?? ""}`}>
                {i + 1}
              </span>
              <Avatar id={row.avatar} size={28} decorative />
              <Link
                to={`/u/${row.username}`}
                className="min-w-0 flex-1 truncate font-display font-semibold text-ink no-underline hover:text-you"
              >
                {row.username}
              </Link>
              <span className="font-mono text-sm text-you">{row.rating}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const MODES = [
  { name: "Ranked", text: "15 min · rating on the line", colour: "text-you" },
  { name: "Blitz", text: "5 min · its own rating", colour: "text-gold", blitz: true },
  { name: "Custom", text: "Room code · play a friend", colour: "text-rival" },
];

/**
 * The visitor's lobby: a short pitch with live proof on the left, and one
 * card on the right that switches between creating an account and logging in.
 * Phones show the pitch in a slim strip, then the card, then the top three.
 */
export function LobbyPage({
  mode,
  onSignedUp,
  onLoggedIn,
}: {
  mode: "signup" | "login";
  onSignedUp: () => void;
  onLoggedIn: () => void;
}) {
  const tab = (key: "signup" | "login", label: string, to: string) => {
    const active = mode === key;
    return (
      <Link
        to={to}
        replace
        aria-current={active ? "page" : undefined}
        className={`flex h-12 flex-1 items-center justify-center border-b-2 font-display font-semibold tracking-widest uppercase no-underline ${
          active ? "border-you bg-you/5 text-you" : "border-transparent text-muted hover:text-ink"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <main className="flex flex-1 justify-center px-4 py-6 md:px-[5%] md:py-10 lg:items-center">
      <div className="grid w-full max-w-6xl content-start items-start gap-6 lg:content-center lg:grid-cols-[1.15fr_1fr] lg:gap-x-12 lg:gap-y-6">
        <section className="flex flex-col items-center gap-3 text-center lg:items-start lg:gap-5 lg:text-left">
          {/* Phones already show the brand in the header. */}
          <div className="hidden items-center gap-3 lg:flex">
            <img
              src="/logo-mark.png"
              alt={BRAND_NAME}
              width={160}
              height={104}
              className="block h-9 w-auto lg:h-14"
            />
            <Wordmark className="text-2xl lg:text-4xl" />
          </div>
          <h1 className="m-0 font-display text-4xl leading-none font-bold tracking-wide uppercase italic sm:text-5xl lg:text-7xl">
            Code. <span className="text-glow-you text-you">Clash.</span>{" "}
            <span className="text-glow-rival text-rival">Climb.</span>
          </h1>
          <p className="m-0 max-w-lg text-soft lg:text-lg">
            Live 1v1 coding battles. Same problem, same clock. First to pass every hidden test wins.
          </p>
          <ul className="m-0 mt-1 hidden list-none gap-2 p-0 lg:grid lg:grid-cols-3">
            {MODES.map((m) => (
              <li key={m.name} className="border border-line bg-panel px-3 py-2.5">
                <p
                  className={`m-0 inline-flex items-center gap-1.5 font-display font-bold tracking-wider uppercase ${m.colour}`}
                >
                  {m.blitz ? <BlitzMark size={14} /> : null}
                  {m.name}
                </p>
                <p className="m-0 mt-0.5 text-xs text-muted">{m.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label={mode === "signup" ? "Create your account" : "Log in to your account"}
          className="w-full border border-line bg-panel lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
        >
          <nav aria-label="Account" className="flex border-b border-line">
            {tab("signup", "Sign up", "/signup")}
            {tab("login", "Log in", "/")}
          </nav>
          <div className="p-5 md:p-7">
            {mode === "signup" ? (
              <SignUpForm onSignedUp={onSignedUp} />
            ) : (
              <>
                <h2 className="mt-0 mb-5 font-display text-2xl font-bold tracking-wider uppercase italic">
                  Welcome back
                </h2>
                <LoginForm onLoggedIn={onLoggedIn} />
              </>
            )}
          </div>
        </section>

        <div className="lg:col-start-1">
          <TopThree />
        </div>
      </div>
    </main>
  );
}
