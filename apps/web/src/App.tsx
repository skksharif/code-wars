import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { ArenaPage } from "./pages/ArenaPage";
import { BattlePage } from "./pages/BattlePage";
import { HistoryPage } from "./pages/HistoryPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RankingsPage } from "./pages/RankingsPage";

/** Sends signed-out visitors to the log-in page and brings them back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Loading…
      </p>
    );
  }
  if (status === "signedOut") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Layout>
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
              <HistoryPage />
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
    </Layout>
  );
}
