import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LobbyPage } from "./LobbyPage";

export function LandingPage() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === "signedIn") return <Navigate to="/arena" replace />;

  return (
    <LobbyPage
      mode="signup"
      onSignedUp={() => navigate("/arena")}
      onLoggedIn={() => navigate("/arena")}
    />
  );
}
