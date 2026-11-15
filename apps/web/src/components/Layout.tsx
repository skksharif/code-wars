import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";

export function Logo() {
  return (
    <Link
      to="/"
      className="text-glow-you font-display text-2xl font-bold tracking-wider text-ink italic no-underline"
    >
      CODE<span className="text-you">WARS</span>
    </Link>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 py-3 font-display font-semibold tracking-widest uppercase no-underline ${
    isActive ? "border-you text-you" : "border-transparent text-muted hover:text-ink"
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { status, profile, service } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await service.signOut();
    navigate("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-[5%] py-3">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap items-center gap-6">
          {status === "signedIn" ? (
            <NavLink to="/arena" className={navLink}>
              Arena
            </NavLink>
          ) : null}
          <NavLink to="/rankings" className={navLink}>
            Rankings
          </NavLink>
          {status === "signedIn" ? (
            <>
              <NavLink to="/history" className={navLink}>
                History
              </NavLink>
              {profile ? (
                <NavLink
                  to={`/u/${profile.username}`}
                  aria-label={`Your profile, rating ${profile.rating}`}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 font-mono text-sm no-underline ${isActive ? "text-you" : "text-soft hover:text-ink"}`
                  }
                >
                  <Avatar id={profile.avatar} size={28} decorative /> {profile.username}{" "}
                  <span className="text-you">{profile.rating}</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={signOut}
                className="h-11 cursor-pointer border border-line-strong bg-transparent px-4 font-display font-semibold tracking-widest text-soft uppercase hover:border-muted"
              >
                Log out
              </button>
            </>
          ) : status === "signedOut" ? (
            <Link
              to="/login"
              className="cut inline-flex h-11 items-center border border-you px-6 font-display font-semibold tracking-widest text-you uppercase no-underline hover:bg-you/10"
            >
              Log in
            </Link>
          ) : null}
        </nav>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
