/**
 * Quick emotes: the only messages players can send each other in a battle.
 * The list is fixed, and only an emote's id travels over the wire, so nobody
 * can send free text. A received id that is not in this list is ignored.
 */
export interface Emote {
  id: string;
  text: string;
  /** A lone emoji, drawn bigger in the tray. */
  emoji?: true;
}

const words: [string, string][] = [
  ["gg", "GG"],
  ["good-luck", "Good luck!"],
  ["nice", "Nice!"],
  ["close-one", "Close one!"],
  ["well-played", "Well played"],
  ["rematch", "Rematch?"],
  ["too-slow", "Too slow 🐢"],
  ["ez", "EZ 😏"],
  ["skill-issue", "Skill issue"],
  ["still-typing", "Still typing?"],
  ["calculated", "Calculated."],
  ["catch-me", "Catch me 🏃"],
  ["is-that-all", "Is that all?"],
  ["speedrun", "Speedrun ⚡"],
  ["free-rating", "Free rating 🤑"],
  ["bot", "Bot."],
  ["uninstall", "Uninstall. 🗑"],
  ["trash-code", "Trash code"],
  ["clown", "Clown 🤡"],
  ["get-rekt", "Get rekt"],
  ["grandma", "My grandma codes faster"],
  ["hello-world", "Hello World is your peak"],
  ["thanks-rating", "Thanks for the rating"],
  ["gg-ez", "GG EZ 😏"],
  ["run-it-back", "Run it back"],
  ["get-good", "Get good"],
  ["lucky", "Lucky problem 🧂"],
];

const emojis: [string, string][] = [
  ["fire", "🔥"],
  ["sweat", "😅"],
  ["clap", "👏"],
  ["handshake", "🤝"],
  ["salute", "🫡"],
  ["wow", "😮"],
  ["sleep", "😴"],
  ["yawn", "🥱"],
  ["skull", "💀"],
  ["salt", "🧂"],
  ["clown-face", "🤡"],
  ["bin", "🗑"],
  ["poop", "💩"],
  ["point-laugh", "🫵😂"],
  ["grave", "🪦"],
  ["baby", "👶"],
];

export const EMOTES: readonly Emote[] = [
  ...words.map(([id, text]) => ({ id, text })),
  ...emojis.map(([id, text]) => ({ id, text, emoji: true as const })),
];

const BY_ID = new Map(EMOTES.map((e) => [e.id, e]));

export function emoteById(id: unknown): Emote | null {
  return typeof id === "string" ? (BY_ID.get(id) ?? null) : null;
}

/** The quick picks on the result screen. */
export const AFTER_BATTLE_EMOTES = [
  "gg",
  "close-one",
  "clap",
  "handshake",
  "gg-ez",
  "run-it-back",
  "get-good",
  "salt",
].map((id) => BY_ID.get(id)!);

/** Alt + 1…8 sends these (the first 8 in the list). */
export const SHORTCUT_EMOTES = EMOTES.slice(0, 8);

/** A player can send one emote this often. */
export const EMOTE_COOLDOWN_MS = 5000;
/** How long a bubble stays up. */
export const EMOTE_SHOW_MS = 3000;
/** Received emotes closer together than this are dropped (anti-spam on the receiving side). */
export const EMOTE_MIN_GAP_MS = 4000;
