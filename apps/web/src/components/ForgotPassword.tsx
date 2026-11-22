import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { AuthError } from "../lib/authService";
import { MIN_PASSWORD, PasswordField } from "./PasswordField";
import { Button, TextField } from "./ui";
import { RESEND_WAIT_S, SIGNUP_CODE_LENGTH } from "./VerifyEmailStep";

const linkButton =
  "cursor-pointer border-0 bg-transparent p-0 text-sm underline-offset-4 hover:underline";

/**
 * Reset by code: ask for the email, send a code, then take the code and a new
 * password together. A correct code signs the player in.
 */
export function ForgotPassword({
  initialEmail = "",
  onDone,
  onBack,
}: {
  initialEmail?: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const { service } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function send(address: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await service.requestPasswordReset(address);
      setSentTo(address);
      setWait(RESEND_WAIT_S);
      if (sentTo) setNotice("A new code is on its way. Older codes no longer work.");
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!sentTo) return;
    setError(null);
    setNotice(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      await service.resetPassword(sentTo, code, password);
      onDone();
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not change the password.");
      setBusy(false);
    }
  }

  const messages = (
    <>
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
    </>
  );

  if (!sentTo) {
    return (
      <form
        noValidate
        aria-label="Reset password"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(email.trim());
        }}
      >
        <p className="m-0 text-soft">
          Enter your account email and we will send a {SIGNUP_CODE_LENGTH}-digit code to choose a
          new password.
        </p>
        <TextField
          id="reset-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {messages}
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send code"}
        </Button>
        <button type="button" onClick={onBack} className={`${linkButton} text-muted`}>
          Back to log in
        </button>
      </form>
    );
  }

  return (
    <form
      noValidate
      aria-label="Choose a new password"
      className="flex flex-col gap-4"
      onSubmit={reset}
    >
      <p className="m-0 text-soft">
        If <b className="break-all text-ink">{sentTo}</b> has an account, a code is on its way. It
        expires in 1 hour.
      </p>
      <TextField
        id="reset-code"
        label="Code from the email"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={SIGNUP_CODE_LENGTH}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, SIGNUP_CODE_LENGTH))}
      />
      <PasswordField
        id="reset-password"
        label="New password"
        autoComplete="new-password"
        meter
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {messages}
      <Button type="submit" disabled={busy || code.length !== SIGNUP_CODE_LENGTH || !password}>
        {busy ? "Saving…" : "Save and log in"}
      </Button>
      <div className="flex flex-wrap justify-between gap-3">
        <button
          type="button"
          disabled={wait > 0 || busy}
          onClick={() => void send(sentTo)}
          className={`${linkButton} text-you disabled:cursor-default disabled:text-muted disabled:no-underline`}
        >
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </button>
        <button type="button" onClick={onBack} className={`${linkButton} text-muted`}>
          Back to log in
        </button>
      </div>
    </form>
  );
}
