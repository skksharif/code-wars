import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../friends/notifications";
import type { Profile } from "../lib/authService";
import { Avatar } from "./Avatar";
import { BRAND_NAME, Wordmark } from "./Brand";

/** The brand: the clashing-brackets mark with the CLASH of CODERS lettering below. */
export function Logo() {
  return (
    <Link
      to="/"
      aria-label={`${BRAND_NAME} home`}
      className="flex flex-none flex-col items-center gap-1 no-underline"
    >
      <img src="/logo-mark.png" alt="" width={55} height={36} className="block h-8 w-auto" />
      <Wordmark className="text-[13px]" />
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
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:inset-x-auto md:bottom-4 md:left-1/2 md:w-96 md:-translate-x-1/2 md:border md:pb-0 md:shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
    >
      <NavLink to="/arena" className={tabLink}>
        <ArenaIcon />
        Arena
      </NavLink>
      <NavLink to="/rankings" className={tabLink}>
        <RankingsIcon />
        Rankings
      </NavLink>
      <NavLink to="/friends" className={tabLink}>
        <FriendsIcon />
        Friends
      </NavLink>
    </nav>
  );
}

function FriendsIcon() {
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
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </svg>
  );
}

/** The bell: friend requests waiting for an answer. Leads to the Friends page. */
function Bell() {
  const { data } = useNotifications();
  const count = data?.friendRequests ?? 0;
  return (
    <NavLink
      to="/friends"
      aria-label={count > 0 ? `Friend requests, ${count} new` : "Friend requests"}
      className={({ isActive }) =>
        `relative flex h-11 w-11 items-center justify-center border no-underline ${
          isActive ? "border-you text-you" : "border-line-strong text-soft hover:text-ink"
        }`
      }
    >
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
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rival px-1 font-mono text-[11px] font-bold text-ground"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </NavLink>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

/**
 * Phones: a hamburger button that opens a small menu with your profile and
 * Log out. Closes on a choice, a tap outside, Escape, or moving to a new page.
 */
function MobileMenu({ profile, onSignOut }: { profile: Profile | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const item =
    "flex min-h-12 w-full items-center gap-3 px-4 text-left no-underline hover:bg-you/10";

  return (
    <div ref={box} className="relative md:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-11 w-11 cursor-pointer items-center justify-center border bg-transparent ${
          open ? "border-you text-you" : "border-line-strong text-soft"
        }`}
      >
        <MenuIcon open={open} />
      </button>
      {open ? (
        <nav
          id="mobile-menu"
          aria-label="Account"
          className="absolute top-full right-0 z-30 mt-2 w-64 border border-line-strong bg-panel py-1 shadow-[0_12px_40px_rgba(0,0,0,0.7)]"
        >
          {profile ? (
            <Link to={`/u/${profile.username}`} className={`${item} text-ink`}>
              <Avatar id={profile.avatar} size={32} decorative />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-display text-lg font-bold">Profile</span>
                <span className="truncate font-mono text-sm text-muted">
                  {profile.username} · <span className="text-you">{profile.rating}</span>
                </span>
              </span>
            </Link>
          ) : null}
          {(
            [
              ["/arena", "Arena", <ArenaIcon key="a" />],
              ["/rankings", "Rankings", <RankingsIcon key="r" />],
              ["/friends", "Friends", <FriendsIcon key="f" />],
            ] as const
          ).map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${item} border-t border-line font-display text-lg font-bold ${isActive ? "text-you" : "text-ink"}`
              }
            >
              <span className="flex w-8 justify-center">{icon}</span>
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={`${item} cursor-pointer border-0 border-t border-line bg-transparent font-display text-lg font-bold text-rival`}
          >
            Log out
          </button>
        </nav>
      ) : null}
    </div>
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
        <div className="flex items-center gap-2 md:gap-3">
          {status === "signedIn" ? <Bell /> : null}
          {status === "signedIn" ? (
            <MobileMenu profile={profile} onSignOut={() => void signOut()} />
          ) : null}
          <nav
            aria-label="Main"
            className={`items-center gap-3 ${status === "signedIn" ? "hidden md:flex" : "flex"}`}
          >
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
        </div>
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
