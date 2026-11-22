import { AVATARS, LIMITS, USERNAME_PATTERN, type AvatarId } from "@code-wars/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { AuthError } from "../lib/authService";
import { AvatarChoice } from "./AvatarChoice";
import { MIN_PASSWORD, PasswordField } from "./PasswordField";
import { Button, TextField } from "./ui";
import { VerifyEmailStep } from "./VerifyEmailStep";

type UsernameCheck = "idle" | "checking" | "available" | "taken" | "invalid";

/** How long typing must pause before the username is checked. */
export const USERNAME_CHECK_DELAY_MS = 400;

function randomAvatar(): AvatarId {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)] ?? "cipher";
}

export function SignUpForm({ onSignedUp }: { onSignedUp: () => void }) {
  const { service } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>(randomAvatar);
  const [check, setCheck] = useState<UsernameCheck>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the account is created and waits for the code from the email. */
  const [verifying, setVerifying] = useState<string | null>(null);
  /** Only the latest check may update the hint (answers can arrive out of order). */
  const latest = useRef("");

  async function checkUsername(value: string): Promise<UsernameCheck> {
    latest.current = value;
    if (!USERNAME_PATTERN.test(value)) {
      setCheck("invalid");
      return "invalid";
    }
    setCheck("checking");
    try {
      const result = (await service.isUsernameAvailable(value)) ? "available" : "taken";
      if (latest.current === value) setCheck(result);
      return result;
    } catch {
      // Could not check: let sign-up itself be the judge.
      if (latest.current === value) setCheck("idle");
      return "idle";
    }
  }

  // Check while typing, once the player pauses.
  useEffect(() => {
    if (!username) {
      latest.current = "";
      setCheck("idle");
      return;
    }
    const timer = window.setTimeout(() => void checkUsername(username), USERNAME_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
    // checkUsername only reads stable values, so the name alone decides when to re-run.
  }, [username]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    const result = check === "available" ? check : await checkUsername(username);
    if (result === "invalid" || result === "taken") return;

    setBusy(true);
    try {
      const address = email.trim();
      const { needsEmailConfirmation } = await service.signUp(address, password, username, avatar);
      if (needsEmailConfirmation) {
        setVerifying(address);
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

  if (verifying) {
    return (
      <VerifyEmailStep
        email={verifying}
        onVerified={onSignedUp}
        onBack={() => setVerifying(null)}
      />
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Create account">
      <p className="m-0 font-mono text-xs tracking-[0.2em] text-muted uppercase">
        Step 1 of 2 · create your player
      </p>
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
          // A new name needs a new check; the old answer no longer applies.
          setCheck("idle");
        }}
        onBlur={() => {
          if (username && check === "idle") void checkUsername(username);
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
      <PasswordField
        id="signup-password"
        label="Password"
        autoComplete="new-password"
        required
        meter
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={`At least ${MIN_PASSWORD} characters`}
      />
      <AvatarChoice value={avatar} onChange={setAvatar} />
      {error ? (
        <p role="alert" className="m-0 text-rival">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !email || !username || !password}>
        {busy ? "Creating…" : "Create account"}
      </Button>
      <p className="m-0 text-center text-sm text-muted">
        Everyone starts at rating 1200. We email you a code to confirm.
      </p>
    </form>
  );
}
