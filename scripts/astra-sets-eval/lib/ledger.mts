// The run's money ledger: append-only JSON lines, fsync'd after every event,
// so a crash or a Ctrl-C never loses a reservation that was made. --resume
// replays it (spend-guard.mts). Token usage only: never a header, a key or
// a prompt.

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";

export type CallKind =
  | "astra"
  | "sonnet-5"
  | "mini-5.4"
  | "gates"
  | "scorer"
  | "drafter"
  | "gpt-image"
  | "flux"
  | "seedream";

export type LedgerEvent =
  | { t: string; ev: "plan"; ceilingUsd: number; maxUsd: number; unpriced: string[] }
  | { t: string; ev: "reserve"; ticket: string; kind: CallKind; worstUsd: number; ref: string }
  | {
      t: string;
      ev: "settle";
      ticket: string;
      actualUsd: number;
      standardUsd: number;
      basis: string;
      usage?: Record<string, unknown> | null;
    }
  | { t: string; ev: "release"; ticket: string; reason: string }
  | {
      t: string;
      ev: "meter";
      host: string;
      model: string;
      usage: Record<string, unknown>;
      usd: number | null;
      tag?: string;
      ref?: string;
    }
  | { t: string; ev: "stop"; reason: "budget" | "sigint" | "config" | "overshoot"; committedUsd: number; maxUsd: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type LedgerInput = DistributiveOmit<LedgerEvent, "t">;

export class Ledger {
  private fd: number | null;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.fd = openSync(path, "a");
  }

  append(e: LedgerInput): LedgerEvent {
    const event = { t: new Date().toISOString(), ...e } as LedgerEvent;
    if (this.fd === null) throw new Error("ledger closed");
    writeSync(this.fd, JSON.stringify(event) + "\n");
    fsyncSync(this.fd);
    return event;
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }

  static read(path: string): LedgerEvent[] {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEvent);
  }
}
