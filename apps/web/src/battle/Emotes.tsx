import { useEffect, useRef, useState } from "react";
import { EMOTE_COOLDOWN_MS, EMOTE_SHOW_MS, EMOTES, SHORTCUT_EMOTES, type Emote } from "./emoteList";
import type { IncomingEmote } from "./useBattle";

export interface EmotesView {
  /** Bubble over your name (what you just sent), or null. */
  mine: Emote | null;
  /** Bubble over the opponent's name, or null (always null while muted). */
  theirs: Emote | null;
  /** True for a few seconds after sending: one emote every 5 seconds. */
  coolingDown: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  send: (emote: Emote) => void;
}

/**
 * Quick emotes in a battle: what is on screen, the 5-second limit, mute, and
 * Alt + 1…8 to send the first 8 without leaving the keyboard.
 */
export function useEmotes(
  incoming: IncomingEmote | null,
  sendEmote: (emoteId: string) => void,
): EmotesView {
  const [muted, setMuted] = useState(false);
  const [expiredSeq, setExpiredSeq] = useState(0);
  const [mine, setMine] = useState<{ emote: Emote; at: number } | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const coolingRef = useRef(false);

  useEffect(() => {
    if (!incoming) return;
    const hide = setTimeout(
      () => setExpiredSeq((seq) => Math.max(seq, incoming.seq)),
      EMOTE_SHOW_MS,
    );
    return () => clearTimeout(hide);
  }, [incoming]);

  useEffect(() => {
    if (!mine) return;
    const hide = setTimeout(() => setMine(null), EMOTE_SHOW_MS);
    return () => clearTimeout(hide);
  }, [mine]);

  useEffect(() => {
    if (!coolingDown) return;
    const ready = setTimeout(() => {
      coolingRef.current = false;
      setCoolingDown(false);
    }, EMOTE_COOLDOWN_MS);
    return () => clearTimeout(ready);
  }, [coolingDown]);

  const sendRef = useRef<(emote: Emote) => void>(() => undefined);
  function send(emote: Emote) {
    if (coolingRef.current) return;
    coolingRef.current = true;
    setCoolingDown(true);
    sendEmote(emote.id);
    setMine({ emote, at: Date.now() });
  }
  sendRef.current = send;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const match = /^Digit([1-8])$/.exec(event.code);
      if (!match) return;
      event.preventDefault();
      const emote = SHORTCUT_EMOTES[Number(match[1]) - 1];
      if (emote) sendRef.current(emote);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const theirs = incoming && !muted && incoming.seq > expiredSeq ? incoming.emote : null;
  return { mine: mine?.emote ?? null, theirs, coolingDown, muted, setMuted, send };
}

/** A bubble that pops up under a player's name for a few seconds. */
export function EmoteBubble({
  emote,
  side,
  who,
  className = "",
}: {
  emote: Emote | null;
  side: "you" | "rival";
  who: string;
  className?: string;
}) {
  if (!emote) return null;
  return (
    <span
      role="status"
      className={`emote-pop pointer-events-none absolute z-20 px-3 py-1 font-display text-sm font-bold whitespace-nowrap text-ground md:text-base ${
        side === "you"
          ? "bg-you shadow-[0_0_18px_rgba(34,230,255,0.55)]"
          : "bg-rival shadow-[0_0_18px_rgba(255,46,154,0.55)]"
      } ${emote.emoji ? "text-xl md:text-2xl" : ""} ${className}`}
    >
      <span className="sr-only">{who}: </span>
      {emote.text}
    </span>
  );
}

function EmoteChoice({
  emote,
  disabled,
  onPick,
  shortcut,
}: {
  emote: Emote;
  disabled: boolean;
  onPick: (emote: Emote) => void;
  shortcut?: number;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(emote)}
      aria-keyshortcuts={shortcut ? `Alt+${shortcut}` : undefined}
      className={`flex cursor-pointer items-center justify-center gap-1 border border-line-strong bg-panel-deep text-ink hover:border-you hover:text-you disabled:cursor-not-allowed disabled:opacity-40 ${
        emote.emoji ? "h-10 text-xl" : "h-9 px-2.5 font-display text-sm font-semibold"
      }`}
    >
      {emote.text}
      {shortcut ? (
        <span aria-hidden="true" className="hidden font-mono text-[10px] text-muted lg:inline">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The 😊 button and its tray of every emote. The tray is positioned against
 * the nearest positioned ancestor, so the caller decides where it opens.
 */
export function EmotePicker({ view, rival }: { view: EmotesView; rival: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(emote: Emote) {
    view.send(emote);
    setOpen(false);
  }

  const words = EMOTES.filter((e) => !e.emoji);
  const emojis = EMOTES.filter((e) => e.emoji);
  return (
    <div ref={wrapper}>
      <button
        type="button"
        aria-label="Emotes"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 border px-3 font-display text-sm font-semibold tracking-widest uppercase ${
          open ? "border-you bg-you/10 text-you" : "border-line-strong bg-transparent text-soft"
        }`}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          😊
        </span>
        <span aria-hidden="true" className="hidden lg:inline">
          Emote
        </span>
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Quick emotes"
          className="absolute top-full right-2 left-2 z-30 mt-1 flex max-h-[60vh] flex-col gap-2 overflow-y-auto border border-you bg-panel p-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.6)] md:left-auto md:w-[560px]"
        >
          <div className="flex flex-wrap gap-1.5">
            {words.map((emote) => (
              <EmoteChoice
                key={emote.id}
                emote={emote}
                disabled={view.coolingDown}
                onPick={pick}
                shortcut={EMOTES.indexOf(emote) < 8 ? EMOTES.indexOf(emote) + 1 : undefined}
              />
            ))}
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {emojis.map((emote) => (
              <EmoteChoice key={emote.id} emote={emote} disabled={view.coolingDown} onPick={pick} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 font-mono text-[11px] text-muted">
            <span>{view.coolingDown ? "Wait a moment…" : "One every 5 seconds"}</span>
            <span className="hidden lg:inline">· Alt + 1…8 to send</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => view.setMuted(!view.muted)}
              className="cursor-pointer border-0 bg-transparent p-1 font-mono text-[11px] text-you underline"
            >
              {view.muted ? `Unmute ${rival}` : `Mute ${rival}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The result screen's row of quick picks, plus the full tray. */
export function SaySomething({
  view,
  rival,
  quick,
}: {
  view: EmotesView;
  rival: string;
  quick: readonly Emote[];
}) {
  return (
    <section
      aria-label="Say something"
      className="relative flex flex-col gap-2 border border-line bg-panel p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-xs font-normal tracking-[0.14em] text-muted uppercase">
          Say something
        </h2>
        <EmotePicker view={view} rival={rival} />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {quick.map((emote) => (
          <EmoteChoice
            key={emote.id}
            emote={emote}
            disabled={view.coolingDown}
            onPick={view.send}
          />
        ))}
      </div>
    </section>
  );
}
