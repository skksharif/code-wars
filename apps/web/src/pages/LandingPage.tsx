import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LobbyPage } from "./LobbyPage";

/** The home page: visitors land on the Log in tab. */
export function LandingPage() {
  return <Lobby mode="login" />;
}

/** /signup: the same lobby, on the Sign up tab. */
export function SignUpPage() {
  return <Lobby mode="signup" />;
}

function Lobby({ mode }: { mode: "signup" | "login" }) {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === "signedIn") return <Navigate to="/arena" replace />;

  return (
    <LobbyPage
      mode={mode}
      onSignedUp={() => navigate("/arena")}
      onLoggedIn={() => navigate("/arena")}
    />
  );
}
