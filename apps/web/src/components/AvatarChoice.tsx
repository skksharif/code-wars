import { AVATAR_INFO, AVATARS, type AvatarId } from "@code-wars/shared";
import type { KeyboardEvent } from "react";
import { Avatar } from "./Avatar";

/** One compact row of the six fighters, used when creating an account. */
export function AvatarChoice({
  value,
  onChange,
}: {
  value: AvatarId;
  onChange: (id: AvatarId) => void;
}) {
  // Arrow keys move the choice, as in any radio group.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next =
      AVATARS[(AVATARS.indexOf(value) + step + AVATARS.length) % AVATARS.length] ?? value;
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-avatar="${next}"]`)?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id="signup-avatar-label" className="text-xs tracking-widest text-muted uppercase">
        Your fighter · <span className="text-you">{AVATAR_INFO[value].name}</span>
      </span>
      <div
        role="radiogroup"
        aria-labelledby="signup-avatar-label"
        onKeyDown={onKey}
        className="grid grid-cols-6 gap-1.5"
      >
        {AVATARS.map((id) => {
          const selected = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              data-avatar={id}
              aria-checked={selected}
              aria-label={AVATAR_INFO[id].name}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              className={`flex cursor-pointer items-center justify-center border p-1 transition ${
                selected
                  ? "border-you bg-you/10 shadow-[0_0_0_1px_rgba(34,230,255,0.4)]"
                  : "border-line bg-ground opacity-70 hover:border-line-strong hover:opacity-100"
              }`}
            >
              <Avatar id={id} size={40} frame={selected ? "#22E6FF" : "#3A4160"} decorative />
            </button>
          );
        })}
      </div>
    </div>
  );
}
