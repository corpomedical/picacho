import { describe, expect, it } from "vitest";
import { behaviourOf, parseCli, resumeFlags } from "./cli.mts";

const ok = (argv: string[]) => {
  const r = parseCli(argv);
  if (!r.ok) throw new Error(r.error);
  return r.cli;
};
const err = (argv: string[]) => {
  const r = parseCli(argv);
  if (r.ok) throw new Error(`expected an error for ${argv.join(" ")}`);
  return r.error;
};

describe("parseCli", () => {
  it("is a dry run by default", () => {
    const c = ok(["a", "/tmp/corpus"]);
    expect(c.cmd).toBe("part");
    if (c.cmd !== "part") return;
    expect(c.flags.spend).toBe(false);
    expect(c.flags.maxUsd).toBeNull();
    expect(c.corpusDir).toBe("/tmp/corpus");
    expect(c.flags.builders).toEqual(["astra-low", "astra-medium", "sonnet-5", "mini-5.4"]);
    expect(c.flags.raters).toEqual(["r1", "r2"]);
  });

  it("needs --spend and --max-usd together", () => {
    expect(err(["a", "c", "--spend"])).toMatch(/--max-usd/);
    expect(err(["a", "c", "--max-usd", "5"])).toMatch(/--spend/);
    const c = ok(["a", "c", "--spend", "--max-usd", "12.5"]);
    expect(c.cmd === "part" && c.flags.maxUsd).toBe(12.5);
  });

  it("rejects a max of zero, a negative, NaN or junk", () => {
    for (const v of ["0", "-1", "NaN", "abc", "1e3", "Infinity"]) {
      expect(err(["a", "c", "--spend", "--max-usd", v])).toMatch(/--max-usd/);
    }
  });

  it("rejects unknown flags and flags for another part", () => {
    expect(err(["a", "c", "--turbo"])).toMatch(/unknown flag/);
    expect(err(["a", "c", "--escalate"])).toMatch(/does not apply to a/);
    expect(err(["b", "c", "--spend", "--max-usd", "1"])).toMatch(/does not apply to b/);
    expect(err(["report", "x", "--spend"])).toMatch(/does not apply to report/);
    expect(err(["a", "c", "--runs", "2", "--runs", "3"])).toMatch(/twice/);
  });

  it("checks positionals", () => {
    expect(err([])).toMatch(/no part/);
    expect(err(["z", "c"])).toMatch(/unknown part/);
    expect(err(["a"])).toMatch(/exactly one corpus/);
    expect(err(["a", "c1", "c2"])).toMatch(/exactly one corpus/);
    expect(err(["report"])).toMatch(/at least one run/);
    const r = ok(["report", "d1", "d2", "--credits", "3"]);
    expect(r.cmd === "report" && r.runDirs).toEqual(["d1", "d2"]);
    expect(r.cmd === "report" && r.flags.credits).toBe(3);
  });

  it("validates values", () => {
    expect(err(["a", "c", "--builders", "astra-high"])).toMatch(/unknown astra-high/);
    expect(err(["a", "c", "--runs", "0"])).toMatch(/--runs/);
    expect(err(["a", "c", "--runs", "1.5"])).toMatch(/--runs/);
    expect(err(["a", "c", "--transport", "flex"])).toMatch(/batch or background/);
    expect(err(["b", "c", "--raters", "solo"])).toMatch(/two distinct/);
    expect(err(["a", "c", "--spend", "--max-usd", "1", "--allow-unpriced", "everything"])).toMatch(/unknown everything/);
    expect(err(["a", "c", "--resume", "dir"])).toMatch(/--spend/);
    expect(err(["a", "c", "--runs"])).toMatch(/needs a value/);
  });

  it("parses the lists and switches", () => {
    const c = ok(["c", "corp", "--engines", "gpt-image,seedream", "--no-control", "--only", "int-01, ext-02", "--seed", "42"]);
    if (c.cmd !== "part") throw new Error("part");
    expect(c.flags.engines).toEqual(["gpt-image", "seedream"]);
    expect(c.flags.control).toBe(false);
    expect(c.flags.only).toEqual(["int-01", "ext-02"]);
    expect(c.flags.seed).toBe(42);
    expect(ok(["a", "c", "--no-words-gate"]).cmd === "part" && (ok(["a", "c", "--no-words-gate"]) as { flags: { wordsGate: boolean } }).flags.wordsGate).toBe(false);
  });

  it("answers --help", () => {
    expect(ok(["a", "--help"]).cmd).toBe("help");
  });
});

describe("--resume keeps the run's behaviour", () => {
  const flagsOf = (argv: string[]) => {
    const c = ok(argv);
    if (c.cmd !== "part") throw new Error("part");
    return c.flags;
  };
  const original = behaviourOf(flagsOf(["a", "c", "--sonnet-mode", "prompt", "--no-words-gate", "--raters", "ann,bo", "--seed", "7"]));
  const resume = ["a", "c", "--resume", "run", "--spend", "--max-usd", "110"];

  it("takes every flag not given again from the original run", () => {
    const r = resumeFlags(flagsOf(resume), original);
    if (!r.ok) throw new Error(r.error);
    expect(r.flags).toMatchObject({ sonnetMode: "prompt", wordsGate: false, raters: ["ann", "bo"], seed: 7, maxUsd: 110 });
  });

  it("accepts a flag given again with the same value, refuses one with another", () => {
    expect(resumeFlags(flagsOf([...resume, "--sonnet-mode", "prompt"]), original).ok).toBe(true);
    const r = resumeFlags(flagsOf([...resume, "--sonnet-mode", "format", "--seed", "8"]), original);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--sonnet-mode \("prompt"\), --seed \(7\)/);
  });

  it("refuses a run with no behaviour record", () => {
    expect(resumeFlags(flagsOf(resume), undefined).ok).toBe(false);
  });
});
