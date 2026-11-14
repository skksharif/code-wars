import { useAuth } from "../auth/AuthContext";
import { Panel } from "../components/ui";

/** Placeholder until the matchmaking and battle screens arrive in module M7. */
export function ArenaPage() {
  const { profile } = useAuth();
  return (
    <main className="flex flex-1 items-center justify-center px-[5%] py-14">
      <Panel className="w-full max-w-xl p-8 text-center">
        <p className="m-0 font-mono text-xs tracking-widest text-you uppercase">Signed in</p>
        <h1 className="my-3 font-display text-4xl font-bold uppercase italic">
          {profile ? profile.username : "Welcome"}
        </h1>
        {profile ? (
          <p className="text-glow-you m-0 font-display text-6xl font-bold text-you">
            {profile.rating}
          </p>
        ) : null}
        <p className="mt-4 mb-0 text-muted">Matchmaking and battles are being built next.</p>
      </Panel>
    </main>
  );
}
