import { useState, type InputHTMLAttributes } from "react";

export const MIN_PASSWORD = 6;

/** 0 = too short, 1 = weak, 2 = okay, 3 = strong. A guide, not a rule. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length < MIN_PASSWORD) return 0;
  let points = 0;
  if (password.length >= 10) points++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points++;
  if (/\d/.test(password)) points++;
  if (/[^A-Za-z0-9]/.test(password)) points++;
  return points >= 3 ? 3 : points >= 1 ? 2 : 1;
}

const STRENGTH = [
  { label: `At least ${MIN_PASSWORD} characters`, colour: "bg-line", text: "text-muted" },
  { label: "Weak", colour: "bg-rival", text: "text-rival" },
  { label: "Okay", colour: "bg-gold", text: "text-gold" },
  { label: "Strong", colour: "bg-you", text: "text-you" },
] as const;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  id: string;
  label: string;
  value: string;
  /** Show the strength bar under the field (for new passwords). */
  meter?: boolean;
};

/** A password input with a show/hide button and an optional strength bar. */
export function PasswordField({ id, label, value, meter = false, ...props }: Props) {
  const [shown, setShown] = useState(false);
  const strength = passwordStrength(value);
  const info = STRENGTH[strength];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs tracking-widest text-muted uppercase">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...props}
          value={value}
          type={shown ? "text" : "password"}
          aria-describedby={meter ? `${id}-strength` : undefined}
          className="h-12 w-full border border-line-strong bg-ground pr-12 pl-3 text-ink placeholder:text-muted/70"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center border-0 bg-transparent text-muted hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {shown ? null : <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>
      {meter ? (
        <div id={`${id}-strength`} className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-3 gap-1" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <span key={n} className={`h-1 ${strength >= n ? info.colour : "bg-line"}`} />
            ))}
          </div>
          <span className={`font-mono text-xs ${info.text}`}>
            {value ? info.label : STRENGTH[0].label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
