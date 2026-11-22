import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LobbyPage } from "./LobbyPage";

export function LoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Only ever return to a path inside this app.
  const from = (location.state as { from?: string } | null)?.from;
  const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/arena";

  if (status === "signedIn") return <Navigate to={target} replace />;

  return (
    <LobbyPage
      mode="login"
      onSignedUp={() => navigate("/arena")}
      onLoggedIn={() => navigate(target, { replace: true })}
    />
  );
}
