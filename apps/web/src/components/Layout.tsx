import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";

/** The brand: the clashing-brackets mark beside the CODE WARS lettering. */
export function Logo() {
  return (
    <Link
      to="/"
      aria-label="Code Wars home"
      className="flex flex-none items-center gap-2 no-underline md:gap-2.5"
    >
      <img src="/logo-mark.png" alt="" width={55} height={36} className="block h-8 w-auto md:h-9" />
      <img
        src="/logo-wordmark.png"
        alt=""
        width={144}
        height={18}
        className="block h-[15px] w-auto md:h-[18px]"
      />
    </Link>
  );
}

/** Top-bar links. On phones they move to the bottom tab bar unless `onPhones`. */
const navLink =
  (onPhones = false) =>
  ({ isActive }: { isActive: boolean }) =>
    `${onPhones ? "inline-block" : "hidden md:inline-block"} border-b-2 py-3 font-display font-semibold tracking-widest uppercase no-underline ${
      isActive ? "border-you text-you" : "border-transparent text-muted hover:text-ink"
    }`;

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
    isActive ? "border-you text-you" : "border-transparent text-muted"
  }`;

/**
 * Phone navigation: a tab bar along the bottom, within reach of the thumb.
 * Hidden on wider screens, where the links sit in the top bar, and during
 * battles, where every pixel goes to the problem and the editor.
 */
function MobileTabBar({ username, avatar }: { username: string; avatar: string }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <NavLink to="/arena" className={tabLink}>
        <ArenaIcon />
        Arena
      </NavLink>
      <NavLink to="/rankings" className={tabLink}>
        <RankingsIcon />
        Rankings
      </NavLink>
      <NavLink to={`/u/${username}`} className={tabLink}>
        <Avatar id={avatar} size={24} decorative />
        Profile
      </NavLink>
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { status, profile, service } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showTabBar = status === "signedIn" && profile !== null && !pathname.startsWith("/battle/");

  async function signOut() {
    await service.signOut();
    navigate("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 md:px-[5%] md:py-3">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-3 md:gap-6">
          {status === "signedIn" ? (
            <NavLink to="/arena" className={navLink()}>
              Arena
            </NavLink>
          ) : null}
          {/* Signed-out visitors have no tab bar, so Rankings stays up here. */}
          <NavLink to="/rankings" className={navLink(status !== "signedIn")}>
            Rankings
          </NavLink>
          {status === "signedIn" ? (
            <>
              {profile ? (
                <NavLink
                  to={`/u/${profile.username}`}
                  aria-label={`Your profile, rating ${profile.rating}`}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 font-mono text-sm no-underline ${isActive ? "text-you" : "text-soft hover:text-ink"}`
                  }
                >
                  <Avatar id={profile.avatar} size={28} decorative />
                  <span className="hidden sm:inline">{profile.username}</span>
                  <span className="text-you">{profile.rating}</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={signOut}
                className="h-10 cursor-pointer border border-line-strong bg-transparent px-2.5 font-display text-xs font-semibold tracking-wider whitespace-nowrap text-soft uppercase hover:border-muted md:h-11 md:px-4 md:text-base md:tracking-widest"
              >
                Log out
              </button>
            </>
          ) : status === "signedOut" ? (
            <Link
              to="/login"
              className="cut inline-flex h-10 items-center border border-you px-4 font-display font-semibold tracking-widest text-you uppercase no-underline hover:bg-you/10 md:h-11 md:px-6"
            >
              Log in
            </Link>
          ) : null}
        </nav>
      </header>
      <div
        className={`flex flex-1 flex-col ${showTabBar ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}
      >
        {children}
      </div>
      {showTabBar && profile ? (
        <MobileTabBar username={profile.username} avatar={profile.avatar} />
      ) : null}
    </div>
  );
}
