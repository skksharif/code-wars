import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";

/** The brand: the clashing-brackets mark with the CODE WARS lettering below. */
export function Logo() {
  return (
    <Link
      to="/"
      aria-label="Code Wars home"
      className="flex flex-none flex-col items-center gap-1 no-underline"
    >
      <img src="/logo-mark.png" alt="" width={55} height={36} className="block h-8 w-auto" />
      <img src="/logo-wordmark.png" alt="" width={112} height={14} className="block h-3.5 w-auto" />
    </Link>
  );
}

function ArenaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 6 2 12l6 6M16 6l6 6-6 6M13.5 4l-3 16" />
    </svg>
  );
}

function RankingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    </svg>
  );
}

const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 font-display text-xs font-semibold tracking-widest uppercase no-underline ${
    isActive ? "border-you text-you" : "border-transparent text-muted hover:text-ink"
  }`;

/**
 * Arena and Rankings live in a tab bar along the bottom, keeping the top bar
 * to just your profile and Log out. Full width on phones (within reach of the
 * thumb), a small centred bar on wide screens, and hidden during battles so
 * every pixel goes to the problem and the editor.
 */
function SectionBar() {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:inset-x-auto md:bottom-4 md:left-1/2 md:w-72 md:-translate-x-1/2 md:border md:pb-0 md:shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
    >
      <NavLink to="/arena" className={tabLink}>
        <ArenaIcon />
        Arena
      </NavLink>
      <NavLink to="/rankings" className={tabLink}>
        <RankingsIcon />
        Rankings
      </NavLink>
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { status, profile, service } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showSections = status === "signedIn" && !pathname.startsWith("/battle/");

  async function signOut() {
    await service.signOut();
    navigate("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 md:px-[5%]">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-2 md:gap-3">
          {status === "signedIn" ? (
            <>
              {profile ? (
                <NavLink
                  to={`/u/${profile.username}`}
                  aria-label={`Your profile, rating ${profile.rating}`}
                  className={({ isActive }) =>
                    `inline-flex h-11 items-center gap-2 border px-2 font-mono text-sm no-underline md:px-3 ${
                      isActive
                        ? "border-you text-you"
                        : "border-line-strong text-soft hover:border-muted hover:text-ink"
                    }`
                  }
                >
                  <Avatar id={profile.avatar} size={28} decorative />
                  <span className="hidden max-w-40 truncate sm:inline">{profile.username}</span>
                  <span className="text-you">{profile.rating}</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={signOut}
                className="h-11 cursor-pointer border border-line-strong bg-transparent px-3 font-display text-sm font-semibold tracking-wider whitespace-nowrap text-soft uppercase hover:border-muted hover:text-ink md:px-4"
              >
                Log out
              </button>
            </>
          ) : status === "signedOut" ? (
            <Link
              to="/login"
              className="cut inline-flex h-11 items-center border border-you px-5 font-display font-semibold tracking-widest text-you uppercase no-underline hover:bg-you/10"
            >
              Log in
            </Link>
          ) : null}
        </nav>
      </header>
      <div
        className={`flex flex-1 flex-col ${showSections ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-24" : ""}`}
      >
        {children}
      </div>
      {showSections ? <SectionBar /> : null}
    </div>
  );
}
