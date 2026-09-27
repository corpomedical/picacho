// The push-to-talk key (2026-09-27, operator: "We should also add a keyboard
// button dedicated if possible to trigger the push to talk", then "Right
// option"). Held, the mic opens like a hold of the lamp; let go, it sends.
// It only works while Picacho's tab has the keyboard — a browser rule.
//
// Kept on this device (localStorage), since a keyboard belongs to a device:
// the key's KeyboardEvent.code, or "off". Right Option (right Alt on Windows)
// by default — it types nothing on its own and still works in a text box.
// Pure but for the two storage helpers.

export const DEFAULT_PTT_KEY = "AltRight";
export const PTT_KEY_STORAGE = "picacho.producer.pttKey";
/** Sent on the window when Settings changes the key, so the lamp follows at once. */
export const PTT_KEY_EVENT = "picacho:ptt-key";
/** Held this long before the mic opens: Option + a letter (é, ü, ©) never opens it. */
export const PTT_KEY_DELAY_MS = 180;

export type PttKey = string | "off";

/** A stored choice, or the default. */
export function parsePttKey(value: string | null | undefined): PttKey {
  if (value === "off") return "off";
  return typeof value === "string" && /^[A-Za-z0-9]{2,24}$/.test(value) ? value : DEFAULT_PTT_KEY;
}

export function readPttKey(): PttKey {
  try {
    return parsePttKey(window.localStorage.getItem(PTT_KEY_STORAGE));
  } catch {
    return DEFAULT_PTT_KEY;
  }
}

export function writePttKey(key: PttKey) {
  try {
    window.localStorage.setItem(PTT_KEY_STORAGE, key);
  } catch {}
  window.dispatchEvent(new CustomEvent(PTT_KEY_EVENT, { detail: key }));
}

/** A key that types a character (a letter, a digit, space, punctuation). */
export function typesCharacter(code: string): boolean {
  return /^(Key[A-Z]|Digit\d|Numpad\d|Space|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash)$/.test(code);
}

/** Keys that can't be the push-to-talk key: they close, move or submit things. */
export function reservedKey(code: string): boolean {
  return /^(Escape|Tab|Enter|NumpadEnter|Backspace|Delete|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(code);
}

const NAMES: Record<string, [mac: string, other: string]> = {
  AltRight: ["Right Option ⌥", "Right Alt"],
  AltLeft: ["Left Option ⌥", "Left Alt"],
  MetaRight: ["Right Command ⌘", "Right Windows key"],
  MetaLeft: ["Left Command ⌘", "Left Windows key"],
  ControlRight: ["Right Control", "Right Ctrl"],
  ControlLeft: ["Left Control", "Left Ctrl"],
  ShiftRight: ["Right Shift", "Right Shift"],
  ShiftLeft: ["Left Shift", "Left Shift"],
  CapsLock: ["Caps Lock", "Caps Lock"],
  Space: ["Space", "Space"],
  Backquote: ["` (backtick)", "` (backtick)"],
  ContextMenu: ["Menu key", "Menu key"],
};

/** What to call a key on this kind of computer. */
export function pttKeyName(code: PttKey, mac: boolean): string {
  if (code === "off") return "Off";
  const known = NAMES[code];
  if (known) return mac ? known[0] : known[1];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Keypad ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** A Mac (its Option and Command names). */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
