import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { AuthError } from "../lib/authService";
import { Button, TextField } from "./ui";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { service } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await service.signIn(email.trim(), password);
      onLoggedIn();
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Log in">
      <TextField
        id="login-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? (
        <p role="alert" className="m-0 text-rival">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !email || !password}>
        {busy ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
