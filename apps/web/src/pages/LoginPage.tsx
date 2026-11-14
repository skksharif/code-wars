import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoginForm } from "../components/LoginForm";
import { Panel } from "../components/ui";

export function LoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Only ever return to a path inside this app.
  const from = (location.state as { from?: string } | null)?.from;
  const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/arena";

  if (status === "signedIn") return <Navigate to={target} replace />;

  return (
    <main className="flex flex-1 items-center justify-center px-[5%] py-14">
      <Panel className="w-full max-w-md p-8">
        <h1 className="mt-0 mb-6 font-display text-3xl font-bold tracking-wider uppercase italic">
          Welcome back
        </h1>
        <LoginForm onLoggedIn={() => navigate(target, { replace: true })} />
        <p className="mt-6 mb-0 text-sm text-muted">
          New here?{" "}
          <Link to="/" className="text-you">
            Create an account
          </Link>
        </p>
      </Panel>
    </main>
  );
}
