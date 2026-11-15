import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";

// A first-time visitor lands on the landing or log-in page, so those two are
// part of the first download. Every other page (the battle room with its
// problem-statement renderer above all) downloads only when it is opened.
const ArenaPage = lazy(() => import("./pages/ArenaPage").then((m) => ({ default: m.ArenaPage })));
const BattlePage = lazy(() =>
  import("./pages/BattlePage").then((m) => ({ default: m.BattlePage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const RankingsPage = lazy(() =>
  import("./pages/RankingsPage").then((m) => ({ default: m.RankingsPage })),
);

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
    <Layout>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
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
                <h1 className="font-display text-4xl font-bold uppercase italic">Page not found</h1>
              </main>
            }
          />
        </Routes>
      </Suspense>
    </Layout>
  );
}
