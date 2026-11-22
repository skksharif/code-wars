import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { AuthError } from "../lib/authService";
import { Button } from "./ui";

export const SIGNUP_CODE_LENGTH = 6;
/** How long before "Send a new code" is offered again (Supabase's own limit is 60 s). */
export const RESEND_WAIT_S = 60;

function digitsOnly(text: string): string {
  return text.replace(/\D/g, "").slice(0, SIGNUP_CODE_LENGTH);
}

/** Six boxes over one real input, so paste, autofill from the email app and screen readers all work. */
function CodeDigits({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="relative w-fit">
      <div aria-hidden="true" className="flex gap-1.5 md:gap-2">
        {Array.from({ length: SIGNUP_CODE_LENGTH }, (_, i) => {
          const ch = value[i];
          const current = focused && i === Math.min(value.length, SIGNUP_CODE_LENGTH - 1);
          return (
            <span
              key={i}
              className={`flex h-14 w-11 items-center justify-center border bg-panel-deep font-mono text-3xl md:h-16 md:w-12 ${
                ch ? "border-you text-you" : "border-line-strong text-muted/40"
              } ${current ? "shadow-[0_0_0_2px_rgba(34,230,255,0.35)]" : ""}`}
            >
              {ch ?? "•"}
            </span>
          );
        })}
      </div>
      <input
        ref={input}
        id="signup-code"
        aria-label={`${SIGNUP_CODE_LENGTH}-digit code`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(digitsOnly(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={SIGNUP_CODE_LENGTH + 4}
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]*"
        className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-base text-transparent caret-transparent opacity-0"
      />
    </div>
  );
}

/**
 * Step 2 of sign-up: the account exists but is not confirmed. The player types
 * the code from the email; a correct code confirms the email and signs them in.
 */
export function VerifyEmailStep({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const { service } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_WAIT_S);
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    if (value.length !== SIGNUP_CODE_LENGTH || busy) return;
    tried.current = value;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await service.verifySignUpCode(email, value);
      onVerified();
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not check the code.");
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setWait(RESEND_WAIT_S);
    try {
      await service.resendSignUpCode(email);
      setCode("");
      tried.current = null;
      setNotice("A new code is on its way. Older codes no longer work.");
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not send a new code.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void verify(code);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Confirm your email"
    >
      <div>
        <p className="m-0 font-mono text-xs tracking-[0.2em] text-you uppercase">
          Step 2 of 2 · confirm your email
        </p>
        <p className="mt-2 mb-0 text-soft">
          We sent a {SIGNUP_CODE_LENGTH}-digit code to <b className="break-all text-ink">{email}</b>
          . It expires in 1 hour. Check spam if it is not there in a minute.
        </p>
      </div>
      <CodeDigits
        value={code}
        disabled={busy}
        onChange={(next) => {
          setCode(next);
          setError(null);
          // Check as soon as the last digit is in (once per code, so a wrong one is not retried).
          if (next.length === SIGNUP_CODE_LENGTH && tried.current !== next) void verify(next);
        }}
      />
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button type="submit" disabled={busy || code.length !== SIGNUP_CODE_LENGTH}>
          {busy ? "Checking…" : "Confirm"}
        </Button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={wait > 0}
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-you underline-offset-4 hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
        >
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-muted underline-offset-4 hover:text-soft hover:underline"
        >
          Wrong email? Go back
        </button>
      </div>
    </form>
  );
}
