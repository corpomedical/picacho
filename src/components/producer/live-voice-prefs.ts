"use client";

import { parseLiveVoice, type LiveVoice } from "@/lib/producer/live";

// Her live voice, while admins try it (2026-09-29, lib/producer/live.ts):
// switched on per device in Settings > Your assistant > Live voice (test),
// read by the lamp when Talk is pressed.

export const LIVE_VOICE_KEY = "picacho.producer.liveVoice";
export const LIVE_VOICE_NAME_KEY = "picacho.producer.liveVoiceName";

export function liveVoiceOn(): boolean {
  try {
    return window.localStorage.getItem(LIVE_VOICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function liveVoiceName(): LiveVoice {
  try {
    return parseLiveVoice(window.localStorage.getItem(LIVE_VOICE_NAME_KEY));
  } catch {
    return parseLiveVoice(null);
  }
}

export function saveLiveVoice(on: boolean, voice: LiveVoice): boolean {
  try {
    window.localStorage.setItem(LIVE_VOICE_KEY, on ? "1" : "0");
    window.localStorage.setItem(LIVE_VOICE_NAME_KEY, voice);
    return true;
  } catch {
    return false;
  }
}
