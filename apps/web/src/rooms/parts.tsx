import {
  cleanRoomCode,
  ROOM_CODE_LENGTH,
  ROOM_DIFFICULTIES,
  ROOM_MINUTES,
  type RoomDifficulty,
  type RoomMinutes,
} from "@code-wars/shared";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import type { Room, RoomPlayer } from "../lib/api";

export const DIFFICULTY_LABELS: Record<RoomDifficulty, string> = {
  any: "Any",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export function settingsText(room: Pick<Room, "difficulty" | "minutes">): string {
  const difficulty =
    room.difficulty === "any" ? "Any difficulty" : DIFFICULTY_LABELS[room.difficulty];
  return `${difficulty} · ${room.minutes} min`;
}

export function joinLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

/** The "UNRATED" badge custom matches carry everywhere. */
export function UnratedBadge() {
  return (
    <span className="inline-block border border-[#5CF2C2] px-2 py-0.5 font-mono text-[11px] tracking-[0.12em] text-[#5CF2C2]">
      UNRATED
    </span>
  );
}

/** A row of mutually exclusive choices (radio buttons styled as a segmented bar). */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span id={`seg-${label}`} className="text-xs tracking-[0.14em] text-muted uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`seg-${label}`}
        className="flex border border-line-strong"
      >
        {options.map((option, index) => {
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={`h-11 min-w-0 flex-1 cursor-pointer border-0 font-display text-sm font-semibold tracking-[0.1em] uppercase ${
                index > 0 ? "border-l border-line-strong" : ""
              } ${selected ? "bg-you text-ground" : "bg-transparent text-muted hover:text-ink"}`}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DifficultyChooser(props: {
  value: RoomDifficulty;
  onChange: (value: RoomDifficulty) => void;
}) {
  return (
    <Segmented
      label="Difficulty"
      options={ROOM_DIFFICULTIES}
      format={(d) => DIFFICULTY_LABELS[d]}
      {...props}
    />
  );
}

export function MinutesChooser(props: {
  value: RoomMinutes;
  onChange: (value: RoomMinutes) => void;
}) {
  return (
    <Segmented label="Time limit" options={ROOM_MINUTES} format={(m) => `${m} min`} {...props} />
  );
}

/** One text box for the 6-character code: upper-cases and drops look-alikes as you type. */
export function RoomCodeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(cleanRoomCode(e.target.value))}
      placeholder="••••••"
      maxLength={ROOM_CODE_LENGTH + 4}
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      inputMode="text"
      className="h-16 w-full border border-line-strong bg-ground px-3 text-center font-mono text-3xl tracking-[0.4em] text-ink uppercase placeholder:text-muted/40 focus:border-you focus:outline-none"
    />
  );
}

/** The code shown big, one character per box. */
export function RoomCodeDisplay({ code }: { code: string }) {
  return (
    <p
      className="m-0 flex justify-center gap-1.5"
      aria-label={`Room code ${code.split("").join(" ")}`}
    >
      {code.split("").map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="flex h-14 w-11 items-center justify-center border border-you bg-panel-deep font-mono text-3xl text-you shadow-[0_0_14px_rgba(34,230,255,0.25)] md:h-16 md:w-12"
        >
          {ch}
        </span>
      ))}
    </p>
  );
}

/** A button that copies text and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const reset = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(reset);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 border border-you bg-transparent px-1 font-display text-xs font-semibold tracking-[0.04em] whitespace-nowrap text-you uppercase hover:bg-you/10 md:px-2 md:text-sm md:tracking-[0.1em]"
    >
      <span aria-live="polite">
        {state === "done" ? "Copied!" : state === "failed" ? "Copy failed" : label}
      </span>
    </button>
  );
}

/** Opens the phone's share sheet (WhatsApp and friends). Hidden where unsupported. */
export function ShareButton({ code }: { code: string }) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return null;
  return (
    <button
      type="button"
      onClick={() =>
        void navigator
          .share({
            title: "Clash of Coders",
            text: `Join my Clash of Coders room: ${code}`,
            url: joinLink(code),
          })
          .catch(() => undefined)
      }
      className="cut glow-you h-12 w-full cursor-pointer border-0 bg-you font-display font-bold tracking-[0.14em] text-ground uppercase"
    >
      Share invite
    </button>
  );
}

/**
 * A room code from pasted text: a bare code ("k7m2qx") or an invite link
 * (".../join/K7M2QX"). Null if it does not contain one.
 */
export function codeFromText(text: string): string | null {
  const fromLink = /\/join\/([A-Za-z0-9]{6})(?:[/?#\s]|$)/.exec(text)?.[1];
  // A bare code must be exactly 6 characters (spaces and dashes aside), so
  // ordinary text is never mistaken for one.
  const bare = text.trim().replace(/[\s-]/g, "");
  const candidate = fromLink ?? (/^[A-Za-z0-9]{6}$/.test(bare) ? bare : "");
  const code = cleanRoomCode(candidate);
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/**
 * The code entry drawn as 6 boxes. Underneath it is one ordinary text box
 * (invisible, covering the boxes), so typing, pasting, phone keyboards and
 * screen readers all work as usual.
 */
export function CodeBoxesInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <div aria-hidden="true" className="flex justify-center gap-1.5 md:gap-2">
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => {
          const ch = value[i];
          const current = focused && i === Math.min(value.length, ROOM_CODE_LENGTH - 1);
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
        id={id}
        value={value}
        onChange={(e) => onChange(cleanRoomCode(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={ROOM_CODE_LENGTH + 4}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-base text-transparent caret-transparent opacity-0"
      />
    </div>
  );
}

/** Copy code · Copy link · Share (share only where the device has a share sheet). */
export function ShareRow({ code }: { code: string }) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className={`grid w-full gap-2 ${canShare ? "grid-cols-3" : "grid-cols-2"}`}>
      <CopyButton text={code} label="Copy code" />
      <CopyButton text={joinLink(code)} label="Copy link" />
      {canShare ? (
        <button
          type="button"
          aria-label="Share invite"
          onClick={() =>
            void navigator
              .share({
                title: "Clash of Coders",
                text: `Join my Clash of Coders room: ${code}`,
                url: joinLink(code),
              })
              .catch(() => undefined)
          }
          className="flex h-11 min-w-0 cursor-pointer items-center justify-center border border-you bg-you/10 px-1 font-display text-xs font-semibold tracking-[0.04em] whitespace-nowrap text-you uppercase hover:bg-you/20 md:px-2 md:text-sm md:tracking-[0.1em]"
        >
          Share
        </button>
      ) : null}
    </div>
  );
}

export function PlayerRow({
  player,
  tag,
  side,
}: {
  player: RoomPlayer;
  tag: string;
  side: "you" | "rival";
}) {
  return (
    <li className="flex items-center gap-3">
      <Avatar
        id={player.avatar}
        size={40}
        frame={side === "you" ? "#22E6FF" : "#FF2E9A"}
        decorative
      />
      <span className="min-w-0 flex-1 truncate font-display text-lg font-bold">
        {player.username}
      </span>
      <span className="font-mono text-xs text-muted">{player.rating}</span>
      <span className={`font-mono text-xs ${side === "you" ? "text-you" : "text-rival"}`}>
        {tag}
      </span>
    </li>
  );
}
