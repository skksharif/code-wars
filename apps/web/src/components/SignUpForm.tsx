import { LIMITS, USERNAME_PATTERN } from "@code-wars/shared";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { AuthError } from "../lib/authService";
import { Button, TextField } from "./ui";

type UsernameCheck = "idle" | "checking" | "available" | "taken" | "invalid";

const MIN_PASSWORD = 6;

export function SignUpForm({ onSignedUp }: { onSignedUp: () => void }) {
  const { service } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [check, setCheck] = useState<UsernameCheck>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkUsername(value: string): Promise<UsernameCheck> {
    if (!USERNAME_PATTERN.test(value)) {
      setCheck("invalid");
      return "invalid";
    }
    setCheck("checking");
    try {
      const result = (await service.isUsernameAvailable(value)) ? "available" : "taken";
      setCheck(result);
      return result;
    } catch {
      // Could not check: let sign-up itself be the judge.
      setCheck("idle");
      return "idle";
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    const result = await checkUsername(username);
    if (result === "invalid" || result === "taken") return;

    setBusy(true);
    try {
      const { needsEmailConfirmation } = await service.signUp(email.trim(), password, username);
      if (needsEmailConfirmation) {
        setNotice("Check your email to confirm your account, then log in.");
      } else {
        onSignedUp();
      }
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  const usernameHint: Record<UsernameCheck, string> = {
    idle: `${LIMITS.usernameMin} to ${LIMITS.usernameMax} letters, digits or underscores.`,
    checking: "Checking…",
    available: "Available.",
    taken: "That username is taken.",
    invalid: `Use ${LIMITS.usernameMin} to ${LIMITS.usernameMax} letters, digits or underscores.`,
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Create account">
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <TextField
          id="signup-username"
          label="Username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setCheck("idle");
          }}
          onBlur={() => {
            if (username) void checkUsername(username);
          }}
          hint={usernameHint[check]}
          tone={
            check === "available"
              ? "good"
              : check === "taken" || check === "invalid"
                ? "bad"
                : "neutral"
          }
        />
        <TextField
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`At least ${MIN_PASSWORD} characters`}
        />
      </div>
      {error ? (
        <p role="alert" className="m-0 text-rival">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="m-0 text-you">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || !email || !username || !password}>
          {busy ? "Creating…" : "Create account"}
        </Button>
        <span className="text-sm text-muted">Everyone starts at rating 1200.</span>
      </div>
    </form>
  );
}
