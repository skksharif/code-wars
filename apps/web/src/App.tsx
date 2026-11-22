import { Suspense, type ReactNode } from "react";
import { lazyPage } from "./lib/lazyPage";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { NotificationsProvider } from "./friends/notifications";
import { OnlineProvider } from "./lib/online";
import { LandingPage, SignUpPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";

// A first-time visitor lands on the landing or log-in page, so those two are
// part of the first download. Every other page (the battle room with its
// problem-statement renderer above all) downloads only when it is opened.
const ArenaPage = lazyPage(() => import("./pages/ArenaPage").then((m) => m.ArenaPage));
const BattlePage = lazyPage(() => import("./pages/BattlePage").then((m) => m.BattlePage));
const FriendsPage = lazyPage(() => import("./pages/FriendsPage").then((m) => m.FriendsPage));
const JoinPage = lazyPage(() => import("./pages/JoinPage").then((m) => m.JoinPage));
const RoomPage = lazyPage(() => import("./pages/RoomPage").then((m) => m.RoomPage));
const ProfilePage = lazyPage(() => import("./pages/ProfilePage").then((m) => m.ProfilePage));
const RankingsPage = lazyPage(() => import("./pages/RankingsPage").then((m) => m.RankingsPage));

function PageLoading() {
  return (
    <p role="status" className="p-10 text-center text-muted">
      Loading…
    </p>
  );
}

/** Sends signed-out visitors to the log-in page and brings them back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <PageLoading />;
  if (status === "signedOut") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Battle history now lives on the player's own profile; old links still work. */
function HistoryRedirect() {
  const { profile } = useAuth();
  if (!profile) return <PageLoading />;
  return <Navigate to={`/u/${profile.username}`} replace />;
}

export function App() {
  return (
    <OnlineProvider>
      <NotificationsProvider>
        <Layout>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
              <Route
                path="/arena"
                element={
                  <RequireAuth>
                    <ArenaPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/battle/:id"
                element={
                  <RequireAuth>
                    <BattlePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/join/:code"
                element={
                  <RequireAuth>
                    <JoinPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/room/:id"
                element={
                  <RequireAuth>
                    <RoomPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/friends"
                element={
                  <RequireAuth>
                    <FriendsPage />
                  </RequireAuth>
                }
              />
              <Route path="/rankings" element={<RankingsPage />} />
              <Route path="/u/:username" element={<ProfilePage />} />
              <Route
                path="/history"
                element={
                  <RequireAuth>
                    <HistoryRedirect />
                  </RequireAuth>
                }
              />
              <Route
                path="*"
                element={
                  <main className="p-10 text-center">
                    <h1 className="font-display text-4xl font-bold uppercase italic">
                      Page not found
                    </h1>
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </Layout>
      </NotificationsProvider>
    </OnlineProvider>
  );
}
