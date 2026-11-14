import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
};

const BUTTON_STYLES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "cut glow-you bg-you text-ground font-bold hover:brightness-110",
  outline: "border border-you text-you hover:bg-you/10",
  ghost: "border border-line-strong text-ink hover:border-muted",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-12 items-center justify-center px-7 font-display font-semibold tracking-widest uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  /** Shown under the field; `tone` decides the colour. */
  hint?: ReactNode;
  tone?: "neutral" | "good" | "bad";
};

export function TextField({ id, label, hint, tone = "neutral", ...props }: TextFieldProps) {
  const border =
    tone === "good" ? "border-you" : tone === "bad" ? "border-rival" : "border-line-strong";
  const hintColor = tone === "good" ? "text-you" : tone === "bad" ? "text-rival" : "text-muted";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs tracking-widest text-muted uppercase">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={tone === "bad"}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`h-12 border bg-ground px-3 text-ink placeholder:text-muted/70 ${border}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className={`m-0 text-sm ${hintColor}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`border border-line bg-panel ${className}`}>{children}</div>;
}
