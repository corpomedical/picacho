// The voice log (2026-09-27, operator: "Aly is barely working when standing
// outside, she does not hear anything and cant speak" — the server had no
// request at all from that time, so the failure was on the phone; he chose
// "Yes, add it"). What the mic, the send and the speaker did, step by step,
// kept on this device for an admin to read (and copy) in the sheet. Only
// timings, sizes, levels and reasons: never the words said.
//
// Off unless enableVoiceLog(true) (the sheet does it for admins).

export type VoiceLogEntry = { t: number; kind: string; detail: string };

const STORAGE = "picacho.producer.voiceLog";
/** The newest entries kept (a few outdoor tests' worth). */
export const VOICE_LOG_MAX = 300;

let enabled = false;
let entries: VoiceLogEntry[] = [];
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((l) => l());
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify(entries));
    } catch {}
  }, 400);
}

export function enableVoiceLog(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  if (on && entries.length === 0) {
    try {
      const raw = window.localStorage.getItem(STORAGE);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(parsed)) entries = parsed.filter((e): e is VoiceLogEntry => !!e && typeof e.t === "number" && typeof e.kind === "string").slice(-VOICE_LOG_MAX);
    } catch {}
    notify();
  }
}

/** One step: what happened, and its numbers ("level 0.04, 2.1 s"). */
export function vlog(kind: string, detail?: Record<string, string | number | boolean | null | undefined> | string) {
  if (!enabled) return;
  entries = appendEntry(entries, { t: Date.now(), kind, detail: describe(detail) });
  save();
  notify();
}

export function appendEntry(list: VoiceLogEntry[], e: VoiceLogEntry, max = VOICE_LOG_MAX): VoiceLogEntry[] {
  const next = [...list, e];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function describe(detail?: Record<string, string | number | boolean | null | undefined> | string): string {
  if (detail === undefined) return "";
  if (typeof detail === "string") return detail;
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k} ${typeof v === "number" ? Math.round(v * 1000) / 1000 : v}`)
    .join(", ");
}

export function subscribeVoiceLog(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getVoiceLog(): VoiceLogEntry[] {
  return entries;
}

const EMPTY: VoiceLogEntry[] = [];
export function getEmptyVoiceLog(): VoiceLogEntry[] {
  return EMPTY;
}

export function clearVoiceLog() {
  entries = [];
  try {
    window.localStorage.removeItem(STORAGE);
  } catch {}
  notify();
}

/** The log as text, oldest first: "14:03:07.412  speech.end  2.1 s, level 0.04". */
export function formatVoiceLog(list: VoiceLogEntry[]): string {
  return list
    .map((e) => {
      const d = new Date(e.t);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
      return `${time}  ${e.kind}${e.detail ? `  ${e.detail}` : ""}`;
    })
    .join("\n");
}

/** The phone's connection as the browser reports it (Chrome and Android only). */
export function connectionNote(): string {
  if (typeof navigator === "undefined") return "";
  const c = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection;
  const parts = [navigator.onLine ? "online" : "OFFLINE"];
  if (c?.effectiveType) parts.push(c.effectiveType);
  if (typeof c?.downlink === "number") parts.push(`${c.downlink} Mb/s down`);
  if (typeof c?.rtt === "number") parts.push(`${c.rtt} ms rtt`);
  if (c?.saveData) parts.push("data saver");
  return parts.join(" · ");
}
