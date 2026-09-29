"use client";

import { parseLiveVoice, type LiveVoice } from "@/lib/producer/live";

// Her live voice (2026-09-29, lib/producer/live.ts): ON unless switched off
// on this device in Settings > Your assistant > Live voice (operator, the
// same day: "Every Aly user"), read by the lamp when Talk is pressed. Off,
// or where the server has it off, Talk gives her usual voice.

export const LIVE_VOICE_KEY = "picacho.producer.liveVoice";
export const LIVE_VOICE_NAME_KEY = "picacho.producer.liveVoiceName";

export function liveVoiceOn(): boolean {
  try {
    return window.localStorage.getItem(LIVE_VOICE_KEY) !== "0";
  } catch {
    return true;
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
