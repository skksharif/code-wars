import { LANGUAGE_LABELS, LANGUAGES } from "@code-wars/shared";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SignUpForm } from "../components/SignUpForm";
import { Panel } from "../components/ui";

export function LandingPage() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === "signedIn") return <Navigate to="/arena" replace />;

  return (
    <main className="flex flex-col items-center gap-8 px-4 py-8 md:gap-10 md:px-[5%] md:py-14">
      <section className="flex flex-col items-center gap-5 text-center">
        <img
          src="/logo.png"
          alt="Code Wars"
          width={560}
          height={299}
          className="block h-auto w-[min(320px,80vw)]"
        />
        <p className="m-0 font-mono text-sm tracking-[0.2em] text-rival uppercase">
          Ranked 1v1 · 15 minutes · winner takes rating
        </p>
        <h1 className="m-0 font-display text-5xl leading-none font-bold tracking-wide uppercase italic sm:text-6xl md:text-8xl">
          Code. <span className="text-glow-you text-you">Clash.</span>{" "}
          <span className="text-glow-rival text-rival">Climb.</span>
        </h1>
        <p className="m-0 max-w-xl text-lg text-soft">
          Get matched with a rival at your rating. Same problem, same clock. First to pass every
          hidden test wins.
        </p>
      </section>

      <section className="flex w-full max-w-5xl flex-wrap items-stretch justify-center gap-6">
        <div className="glow-you min-w-0 flex-1 basis-72 border border-you bg-panel p-6">
          <p className="m-0 font-mono text-xs tracking-widest text-you uppercase">Player one</p>
          <p className="m-0 font-display text-3xl font-bold">YOU</p>
          <p className="m-0 font-mono text-sm text-muted">
            {LANGUAGES.map((l) => LANGUAGE_LABELS[l]).join(" · ")}
          </p>
        </div>
        <div
          className="flex items-center font-display text-6xl font-bold italic"
          aria-hidden="true"
        >
          VS
        </div>
        <div className="glow-rival min-w-0 flex-1 basis-72 border border-rival bg-panel p-6 text-right">
          <p className="m-0 font-mono text-xs tracking-widest text-rival uppercase">Player two</p>
          <p className="m-0 font-display text-3xl font-bold">YOUR RIVAL</p>
          <p className="m-0 font-mono text-sm text-muted">Matched within 100 rating points</p>
        </div>
      </section>

      <Panel className="w-full max-w-5xl p-5 md:p-7">
        <h2 className="mt-0 mb-5 font-display text-2xl font-bold tracking-wider uppercase">
          Enter the arena
        </h2>
        <SignUpForm onSignedUp={() => navigate("/arena")} />
        <p className="mt-5 mb-0 text-sm text-muted">
          Already a player?{" "}
          <Link to="/login" className="text-you">
            Log in
          </Link>
        </p>
      </Panel>
    </main>
  );
}
