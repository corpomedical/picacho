"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { formatMsg } from "@/lib/i18n/format";
import { clearSetEdit, editSetWithAstra, saveSetEdit } from "@/lib/sets/editor-actions";
import { SET_EDIT_TOO_BIG } from "@/lib/sets/messages";
import { SET_EDIT_MAX_SPEC_CHARS } from "@/lib/sets/set-config";
import {
  addCamera,
  addLight,
  addMark,
  addObject,
  duplicateObject,
  patchCamera,
  patchFog,
  patchGround,
  patchLight,
  patchMark,
  patchObject,
  patchSky,
  removeCamera,
  removeLight,
  removeMark,
  removeObject,
  selectionAfter,
  sizeFromScale,
  type EditResult,
  type EditTarget,
} from "@/lib/sets/editor-model";
import {
  SET_LIMITS,
  SET_SHAPES,
  SET_SKY_KINDS,
  specInstanceCount,
  type SetLightKind,
  type SetObject,
  type SetShape,
  type SetSpec,
  type Vec3,
} from "@/lib/sets/set-spec";

// The Set Editor (drawn 2026-09-14, canvas page G): Adobe's grammar in
// Picacho's skin. The set page's second life — Build beside Shoot — laid out
// the way a pro tool is laid out: a tool rail on the left (Select, Move,
// Turn, Size, Add), the canvas docked in the middle with the gizmo every 3D
// hand knows (red X, green Y, blue Z), a context bar of exact numbers over
// it, the Scene tree and the Properties inspector on the right, a status
// bar under everything — and Astra as the prompt bar floating at the
// canvas's foot, the way Photoshop's contextual task bar floats.
//
// Dark on purpose: editors go dark around the work, the way Lightroom goes
// dark around a photo. It keeps one look in both themes, like the stage.
//
// EVERY edit — dragged, typed, or Astra's — is a whole new spec through
// normaliseSetSpec (editor-model.ts), never a patched scene: the same trust
// boundary as the first build, on every change. Edits land in ONE history
// (Edit n, ↺ ↻, this visit), autosave writes the working copy
// (editor-actions.ts saveSetEdit — the server holds the text), and Astra's
// original always brings the untouched set back. Astra's word edits run
// server-side, gated whole like a build (editSetWithAstra).

type Tool = "select" | "move" | "rotate" | "scale";

type GizmoChange = {
  position?: Vec3;
  rotationDeg?: Vec3;
  scale?: { x: number; y: number; z: number };
};

type EditorApi = {
  rebuild(spec: SetSpec): void;
  applySelection(sel: EditTarget | null): void;
  applyTool(tool: Tool): void;
  applySnap(on: boolean): void;
  viewCenter(): [number, number];
  viewPose(): { position: Vec3; target: Vec3; fovDeg: number };
};

// ---- the skin: one dark look in both themes, like the stage ----
const ACCENT = "#e0a468";
const BAR = "bg-[#191a20]";
const PANEL = "bg-[#1f2026]";
const HAIR = "border-white/[0.07]";
const FLD =
  "h-6 w-full min-w-0 rounded-[4px] border-0 bg-[#141519] px-1.5 text-right text-[11.5px] tabular-nums text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] outline-none focus:shadow-[inset_0_0_0_1px_#e0a468]";
const TOOL_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-[#9aa0ad] hover:text-[#ecedf1]";
const TOOL_ON = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] bg-[rgba(224,164,104,0.13)] text-[#e0a468]";
const ICON_BTN =
  "inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[5px] text-[#9aa0ad] hover:text-[#ecedf1] disabled:cursor-default disabled:opacity-35";
const PHEAD =
  "flex h-8 flex-none items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]";
const SHEAD = "flex h-6 items-center px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b6f7a]";
const ROW_LABEL = "w-[58px] flex-none text-[11px] text-[#9aa0ad]";

function Svg({ d, className, box = "0 0 24 24" }: { d: string; className?: string; box?: string }) {
  return (
    <svg
      viewBox={box}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-[17px] w-[17px]"}
      aria-hidden
    >
      {d.split("|").map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const D = {
  select: "M5 3l14 8-6.5 1.5L9 19z",
  move: "M12 2v20M2 12h20|m9 5 3-3 3 3M9 19l3 3 3-3M5 9 2 12l3 3M19 9l3 3-3 3",
  rotate: "M21 12a9 9 0 1 1-3-6.7|M21 3v5h-5",
  scale: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  add: "M12 5v14M5 12h14",
  undo: "M9 14 4 9l5-5|M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5|M20 9H10a6 6 0 0 0 0 12h3",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6",
  copy: "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2|M8 8h12v12H8z",
  sun: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  bulb: "M9 18h6M10 21h4|M12 3a6 6 0 0 1 3.6 10.8c-.6.5-.6 1.2-.6 1.2h-6s0-.7-.6-1.2A6 6 0 0 1 12 3z",
  person: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z|M6 20a6 6 0 0 1 12 0",
  camera: "m22 8-6 3 6 3z|M2 6h14v12H2z",
  sky: "M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.6A4 4 0 0 0 6 18z",
  cube: "M21 8.5v7L12 20l-9-4.5v-7L12 4z|M3 8.5 12 13l9-4.5M12 13v7",
  check: "M20 6 9 17l-5-5",
};

/** A number the panel edits: committed on Enter or blur, reset on junk. */
function Num({
  value,
  onCommit,
  min,
  max,
  ax,
  unit,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  ax?: string;
  unit?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => String(value));
  // A fresh value from outside replaces the draft, the render-time way.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  const commitText = () => {
    const n = Number.parseFloat(text.replace(",", "."));
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    v = Math.round(v * 100) / 100;
    if (v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className ?? "flex-1"}`}>
      {ax && <span className="text-[9.5px] font-semibold text-[#6b6f7a]">{ax}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={FLD}
      />
      {unit && <span className="text-[10px] text-[#565a64]">{unit}</span>}
    </span>
  );
}

function Vec3Row({
  value,
  onCommit,
  min,
  max,
  axes = ["X", "Y", "Z"],
}: {
  value: Vec3;
  onCommit: (v: Vec3) => void;
  min?: number;
  max?: number;
  axes?: [string, string, string];
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {([0, 1, 2] as const).map((i) => (
        <Num
          key={axes[i]}
          ax={axes[i]}
          value={value[i]}
          min={min}
          max={max}
          onCommit={(v) => {
            const next: Vec3 = [...value];
            next[i] = v;
            onCommit(next);
          }}
        />
      ))}
    </span>
  );
}

/** A colour the panel edits: the picker debounced, the hex checked. */
function ColorField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const commitHex = () => {
    const v = text.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) {
      if (v !== value) onCommit(v);
    } else setText(value);
  };
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-6 w-7 flex-none overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => onCommit(v), 400);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={`${FLD} w-20 flex-none text-left`}
      />
    </span>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setV(value);
  }
  const commitLocal = () => {
    if (v !== value) onCommit(v);
  };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commitLocal}
        onKeyUp={commitLocal}
        onBlur={commitLocal}
        className="min-w-0 flex-1 accent-[#e0a468]"
      />
      <Num value={value} onCommit={onCommit} min={min} max={max} className="w-14 flex-none" />
    </span>
  );
}

function Check({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className="flex cursor-pointer items-center gap-2 text-[12px] text-[#c6c9d1]">
      <span
        className={`inline-flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] ${on ? "bg-[#e0a468] text-[#1b1c20]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"}`}
      >
        {on && <Svg d={D.check} className="h-2.5 w-2.5" />}
      </span>
      {children}
    </button>
  );
}

function PRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-1.5 px-3">
      <span className={ROW_LABEL}>{label}</span>
      {children}
    </div>
  );
}

function TreeRow({
  icon,
  dot,
  name,
  badge,
  child,
  selected,
  onPick,
}: {
  icon?: keyof typeof D;
  dot?: string;
  name: string;
  badge?: string;
  child?: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex h-6 w-full cursor-pointer items-center gap-1.5 pr-2.5 text-left text-[12px] ${child ? "pl-7" : "pl-3"} ${
        selected ? "bg-[rgba(224,164,104,0.12)] text-[#e0a468] shadow-[inset_2px_0_0_#e0a468]" : "text-[#c6c9d1] hover:bg-white/[0.04]"
      }`}
    >
      {dot ? (
        <span className="h-2.5 w-2.5 flex-none rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ background: dot }} />
      ) : icon ? (
        <Svg d={D[icon]} className={`h-[13px] w-[13px] flex-none ${selected ? "" : "text-[#8b8f9a]"}`} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {badge && <span className="flex-none text-[11px] tabular-nums text-[#6b6f7a]">{badge}</span>}
    </button>
  );
}

export function SetEditor({
  setId,
  original,
  initialEdited,
  closeHref,
  astraEditsLeft,
}: {
  setId: string;
  /** Astra's set as first built — never changed, always restorable. */
  original: SetSpec;
  /** The saved working copy, if the person has edited before. */
  initialEdited: SetSpec | null;
  closeHref: string;
  /** Astra changes left this billing month (set-config.ts SET_EDITS_MONTHLY_LIMITS); null when uncapped or unread. */
  astraEditsLeft: number | null;
}) {
  const { t } = useLocale();
  const s = t.sets;
  const router = useRouter();

  const [spec, setSpec] = useState<SetSpec>(initialEdited ?? original);
  const [sel, setSel] = useState<EditTarget | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [snap, setSnap] = useState(true);
  const [history, setHistory] = useState<string[]>(() => [JSON.stringify(initialEdited ?? original)]);
  const [at, setAt] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [flash, setFlash] = useState("");
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState<number | null>(null);
  // The month's Astra changes left, as the server last said.
  const [editsLeft, setEditsLeft] = useState<number | null>(astraEditsLeft);
  // A set grown past what Astra can answer whole is changed with the tools
  // alone (set-config.ts SET_EDIT_MAX_SPEC_CHARS); the server refuses it too.
  const astraTooBig = useMemo(() => JSON.stringify(spec).length > SET_EDIT_MAX_SPEC_CHARS, [spec]);
  const [askError, setAskError] = useState("");

  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const specRef = useRef(spec);
  const selRef = useRef<EditTarget | null>(null);
  const toolRef = useRef<Tool>(tool);
  const snapRef = useRef(snap);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickRef = useRef<(next: EditTarget | null) => void>(() => {});
  const gizmoRef = useRef<(target: EditTarget, change: GizmoChange) => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const deleteRef = useRef<() => void>(() => {});
  const addOpenRef = useRef(false);

  function flashLine(text: string) {
    setFlash(text);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(""), 4000);
  }

  function scheduleSave(next: SetSpec) {
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveSetEdit(setId, next).then((r) => setSaveState(r.error ? "failed" : "saved"));
    }, 1200);
  }

  function applySpec(next: SetSpec) {
    specRef.current = next;
    setSpec(next);
    apiRef.current?.rebuild(next);
  }

  /** Every accepted edit: history, stage, autosave. A refused one flashes and stands down. */
  function commit(result: EditResult) {
    if (!result.ok) {
      flashLine(s.editorRefused);
      return;
    }
    const trimmed = [...history.slice(0, at + 1), JSON.stringify(result.spec)].slice(-60);
    setHistory(trimmed);
    setAt(trimmed.length - 1);
    applySpec(result.spec);
    scheduleSave(result.spec);
    if (result.notes.includes("repeat_truncated") || result.notes.includes("objects_capped")) flashLine(s.editorCapped);
    else if (result.notes.includes("default_lights")) flashLine(s.editorRelit);
  }

  /** An edit Astra already saved server-side: history and stage, no re-save. */
  function commitFromServer(next: SetSpec) {
    const trimmed = [...history.slice(0, at + 1), JSON.stringify(next)].slice(-60);
    setHistory(trimmed);
    setAt(trimmed.length - 1);
    applySpec(next);
    setSaveState("saved");
  }

  function goTo(index: number) {
    if (index < 0 || index >= history.length) return;
    const next = JSON.parse(history[index]) as SetSpec;
    // The thing in hand stays in hand, wherever the step left it
    // (editor-model.ts) — set before the rebuild, which puts the gizmo back
    // on whatever selRef names.
    const keep = selectionAfter(sel, specRef.current, next);
    selRef.current = keep;
    setSel(keep);
    setAt(index);
    applySpec(next);
    scheduleSave(next);
  }

  function undo() {
    goTo(at - 1);
  }

  function redo() {
    goTo(at + 1);
  }

  function removeSelected() {
    if (!sel) return;
    const cur = specRef.current;
    if (sel.kind === "object") {
      const r = removeObject(cur, sel.index);
      if (!r.ok) {
        flashLine(s.editorKeepOneThing);
        return;
      }
      setSel(null);
      commit(r);
    } else if (sel.kind === "light") {
      setSel(null);
      commit(removeLight(cur, sel.index));
    } else if (sel.kind === "mark") {
      const r = removeMark(cur, sel.index);
      if (!r.ok) {
        flashLine(s.editorKeepOneMark);
        return;
      }
      setSel(null);
      commit(r);
    } else if (sel.kind === "camera") {
      const r = removeCamera(cur, sel.index);
      if (!r.ok) {
        flashLine(s.editorKeepOneCamera);
        return;
      }
      setSel(null);
      commit(r);
    }
  }

  function duplicateSelected() {
    if (sel?.kind !== "object") return;
    const r = duplicateObject(specRef.current, sel.index);
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "object", index: sel.index + 1 });
  }

  function addThing(shape: SetShape) {
    setAddOpen(false);
    const atXZ = apiRef.current?.viewCenter() ?? [0, 0];
    const r = addObject(specRef.current, shape, atXZ);
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "object", index: r.spec.objects.length - 1 });
  }

  function addALight() {
    setAddOpen(false);
    const r = addLight(specRef.current, "point");
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "light", index: r.spec.lights.length - 1 });
  }

  function addAMark() {
    setAddOpen(false);
    const atXZ = apiRef.current?.viewCenter() ?? [0, 0];
    const r = addMark(specRef.current, atXZ);
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "mark", index: r.spec.marks.length - 1 });
  }

  function addACamera() {
    setAddOpen(false);
    const pose = apiRef.current?.viewPose();
    if (!pose) return;
    const r = addCamera(specRef.current, pose);
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "camera", index: r.spec.cameras.length - 1 });
  }

  /** The gizmo let go: the dragged transform, back through the trust boundary. */
  function handleGizmo(target: EditTarget, change: GizmoChange) {
    const cur = specRef.current;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    if (target.kind === "object") {
      const o = cur.objects[target.index];
      if (!o) return;
      const patch: Partial<SetObject> = {};
      if (change.position) patch.position = change.position.map(r2) as Vec3;
      if (change.rotationDeg) patch.rotation = change.rotationDeg.map((d) => Math.round(d * 10) / 10) as Vec3;
      if (change.scale) patch.size = sizeFromScale(o, change.scale).map(r2) as Vec3;
      commit(patchObject(cur, target.index, patch));
    } else if (target.kind === "light" && change.position) {
      commit(patchLight(cur, target.index, { position: change.position.map(r2) as Vec3 }));
    } else if (target.kind === "mark") {
      const patch: { x?: number; z?: number; facingDeg?: number } = {};
      if (change.position) {
        patch.x = r2(change.position[0]);
        patch.z = r2(change.position[2]);
      }
      if (change.rotationDeg) patch.facingDeg = Math.round(((change.rotationDeg[1] % 360) + 360) % 360);
      commit(patchMark(cur, target.index, patch));
    } else if (target.kind === "camera" && change.position) {
      commit(patchCamera(cur, target.index, { position: change.position.map(r2) as Vec3 }));
    }
  }

  /** Astra's original, back on the stage — an edit like any other, so ↺ undoes it. */
  async function restoreOriginal() {
    if (JSON.stringify(specRef.current) === JSON.stringify(original)) return;
    const trimmed = [...history.slice(0, at + 1), JSON.stringify(original)].slice(-60);
    setHistory(trimmed);
    setAt(trimmed.length - 1);
    setSel(null);
    applySpec(original);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveState("saving");
    const r = await clearSetEdit(setId);
    setSaveState(r.error ? "failed" : "saved");
  }

  /** Back to shooting: whatever is pending saves first, then the workspace. */
  async function done() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const r = await saveSetEdit(setId, specRef.current);
      setSaveState(r.error ? "failed" : "saved");
    }
    router.push(closeHref);
    router.refresh();
  }

  async function sendAsk() {
    const text = ask.trim();
    if (!text || asking || astraTooBig) return;
    setAsking(true);
    setAskError("");
    setAskNote(null);
    let r: Awaited<ReturnType<typeof editSetWithAstra>>;
    try {
      r = await editSetWithAstra(setId, text);
    } catch (err) {
      // A dropped connection or a stale deploy: the bar is let go and says
      // so, rather than saying Astra is still at work for good.
      const stale = isStaleDeployError(err);
      setAskError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
    } finally {
      setAsking(false);
    }
    if (r.editsLeft !== undefined) setEditsLeft(r.editsLeft);
    if (r.error !== null) {
      setAskError(r.error);
      return;
    }
    setAsk("");
    commitFromServer(r.spec);
    setAskNote(r.changed);
  }

  // ---- the stage ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
        const { buildSetScene, buildStandIn, placeStandIn } = await import("@/lib/sets/build-scene");
        const { BASE_EXPOSURE } = await import("@/lib/sets/exposure");
        if (disposed || !hostRef.current) return;

        const DEG = Math.PI / 180;
        const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        const shadows = !coarse;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        // No lift here, on purpose: the editor shows the set as built, so a
        // person lighting it sees what they are doing (the shoot stage keeps
        // its lift).
        renderer.toneMappingExposure = BASE_EXPOSURE;
        renderer.shadowMap.enabled = shadows;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        const canvas = renderer.domElement;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        canvas.style.touchAction = "none";
        host.appendChild(canvas);

        const spec0 = specRef.current;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(spec0.cameras[0].fovDeg, 1, 0.05, 4000);
        camera.position.set(...spec0.cameras[0].position);

        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 0.3;
        controls.maxPolarAngle = Math.PI * 0.62;
        controls.target.set(...spec0.cameras[0].target);
        controls.update();

        // What one build of the scene owns, replaced whole on every edit.
        type ThreeMesh = InstanceType<typeof THREE.Mesh>;
        let built: ReturnType<typeof buildSetScene> | null = null;
        let objectMeshes: ThreeMesh[] = [];
        let firstMeshOf: (ThreeMesh | null)[] = [];
        let standIns: ReturnType<typeof buildStandIn>[] = [];
        let handleDisposables: { dispose(): void }[] = [];
        let outline: InstanceType<typeof THREE.Box3Helper> | null = null;
        const handlesGroup = new THREE.Group();
        scene.add(handlesGroup);

        const handleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ACCENT) });
        const lineMat = new THREE.LineDashedMaterial({ color: new THREE.Color(ACCENT), dashSize: 0.5, gapSize: 0.5, transparent: true, opacity: 0.7 });
        const handleGeo = new THREE.SphereGeometry(0.22, 16, 12);
        const camGeo = new THREE.BoxGeometry(0.4, 0.26, 0.55);

        const tc = new TransformControls(camera, canvas);
        tc.setSize(0.85);
        scene.add(tc.getHelper());

        const clearOutline = () => {
          if (!outline) return;
          scene.remove(outline);
          outline.geometry.dispose();
          (outline.material as InstanceType<typeof THREE.Material>).dispose();
          outline = null;
        };

        const clearHandles = () => {
          handlesGroup.clear();
          for (const st of standIns) st.dispose();
          standIns = [];
          for (const d of handleDisposables) d.dispose();
          handleDisposables = [];
        };

        const rebuildHandles = (spec: SetSpec) => {
          clearHandles();
          spec.lights.forEach((l, li) => {
            if (l.kind === "ambient" || l.kind === "hemisphere") return;
            const h = new THREE.Mesh(handleGeo, handleMat);
            h.position.set(...l.position);
            h.userData.target = { kind: "light", index: li } satisfies EditTarget;
            handlesGroup.add(h);
            if (l.kind === "sun" || l.kind === "spot") {
              const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...l.position), new THREE.Vector3(...l.target)]);
              handleDisposables.push(geo);
              const line = new THREE.Line(geo, lineMat);
              line.computeLineDistances();
              handlesGroup.add(line);
            }
          });
          spec.marks.forEach((m, mi) => {
            const st = buildStandIn(THREE, ACCENT);
            placeStandIn(st, m);
            st.group.userData.target = { kind: "mark", index: mi } satisfies EditTarget;
            handlesGroup.add(st.group);
            standIns.push(st);
          });
          spec.cameras.forEach((c, ci) => {
            const box = new THREE.Mesh(camGeo, handleMat);
            box.position.set(...c.position);
            box.lookAt(new THREE.Vector3(...c.target));
            box.userData.target = { kind: "camera", index: ci } satisfies EditTarget;
            handlesGroup.add(box);
          });
        };

        const meshFor = (target: EditTarget | null): InstanceType<typeof THREE.Object3D> | null => {
          if (!target) return null;
          if (target.kind === "object") return firstMeshOf[target.index] ?? null;
          for (const child of handlesGroup.children) {
            const tt = child.userData.target as EditTarget | undefined;
            if (tt && "index" in tt && tt.kind === target.kind && "index" in target && tt.index === target.index) return child;
          }
          return null;
        };

        const applyTool = (nextTool: Tool) => {
          const target = selRef.current;
          const obj = meshFor(target);
          tc.detach();
          if (!target || !obj || nextTool === "select") return;
          let mode: "translate" | "rotate" | "scale" =
            nextTool === "rotate" ? "rotate" : nextTool === "scale" ? "scale" : "translate";
          // Lights and cameras are placed, never turned or sized, by hand;
          // a mark turns only on its facing; a ring's size is geometry.
          if (target.kind === "light" || target.kind === "camera") mode = "translate";
          if (target.kind === "mark" && mode === "scale") mode = "translate";
          if (target.kind === "object" && mode === "scale" && specRef.current.objects[target.index]?.shape === "torus") return;
          tc.setMode(mode);
          tc.showX = true;
          tc.showY = true;
          tc.showZ = true;
          if (target.kind === "mark") {
            if (mode === "rotate") {
              tc.showX = false;
              tc.showZ = false;
            } else {
              tc.showY = false;
            }
          }
          tc.attach(obj);
        };

        const applySelection = (target: EditTarget | null) => {
          clearOutline();
          tc.detach();
          const obj = meshFor(target);
          if (!obj) return;
          const box = new THREE.Box3().setFromObject(obj);
          outline = new THREE.Box3Helper(box, new THREE.Color(ACCENT));
          scene.add(outline);
          applyTool(toolRef.current);
        };

        const applySnap = (on: boolean) => {
          tc.translationSnap = on ? 0.1 : null;
          tc.rotationSnap = on ? 15 * DEG : null;
          tc.setScaleSnap(on ? 0.1 : null);
        };
        applySnap(snapRef.current);

        const disposeBuilt = () => {
          if (!built) return;
          scene.remove(built.root);
          built.dispose();
          built = null;
        };

        const rebuildScene = (spec: SetSpec) => {
          clearOutline();
          tc.detach();
          disposeBuilt();
          built = buildSetScene(THREE, spec, { shadows });
          scene.add(built.root);
          scene.background = built.background;
          scene.fog = built.fog;
          camera.far = built.farPlane;
          camera.updateProjectionMatrix();
          controls.maxDistance = Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10;
          // The object meshes are the interpreter's last meshCount children,
          // one per drawn instance, in spec order — tagged here so a click
          // knows which object it hit (editor-model.test pins the order).
          const kids = built.root.children;
          const meshes = kids.slice(kids.length - built.meshCount) as ThreeMesh[];
          objectMeshes = meshes;
          firstMeshOf = [];
          let cursor = 0;
          spec.objects.forEach((o, oi) => {
            const count = o.repeat?.count ?? 1;
            firstMeshOf[oi] = meshes[cursor] ?? null;
            for (let k = 0; k < count; k++) {
              const m = meshes[cursor + k];
              if (m) m.userData.oi = oi;
            }
            cursor += count;
          });
          rebuildHandles(spec);
          applySelection(selRef.current);
        };

        tc.addEventListener("dragging-changed", (e) => {
          const dragging = (e as unknown as { value: boolean }).value;
          controls.enabled = !dragging;
          if (dragging) return;
          const target = selRef.current;
          const obj = tc.object;
          if (!target || !obj) return;
          const change: GizmoChange = {};
          if (tc.mode === "translate") change.position = [obj.position.x, obj.position.y, obj.position.z];
          if (tc.mode === "rotate") change.rotationDeg = [obj.rotation.x / DEG, obj.rotation.y / DEG, obj.rotation.z / DEG];
          if (tc.mode === "scale") change.scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
          gizmoRef.current(target, change);
        });

        // A click picks; a drag orbits. The gizmo's own drags never get here
        // (it captures the pointer), so only still clicks select.
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let downAt: { x: number; y: number } | null = null;
        const onDown = (e: PointerEvent) => {
          if (e.button !== 0) return;
          downAt = { x: e.clientX, y: e.clientY };
        };
        const onUp = (e: PointerEvent) => {
          if (!downAt) return;
          const movedPx = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
          downAt = null;
          if (movedPx > 5 || tc.dragging) return;
          const r = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObjects([...handlesGroup.children, ...objectMeshes], true);
          for (const h of hits) {
            let o: InstanceType<typeof THREE.Object3D> | null = h.object;
            while (o) {
              const tt = o.userData.target as EditTarget | undefined;
              if (tt) {
                pickRef.current(tt);
                return;
              }
              if (typeof o.userData.oi === "number") {
                pickRef.current({ kind: "object", index: o.userData.oi });
                return;
              }
              o = o.parent;
            }
          }
          pickRef.current(null);
        };
        canvas.addEventListener("pointerdown", onDown);
        canvas.addEventListener("pointerup", onUp);

        let raf = 0;
        let lastW = 0;
        let lastH = 0;
        const fit = () => {
          const w = host.clientWidth;
          const h = host.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          renderer.setSize(w, h, false);
          camera.aspect = w / Math.max(1, h);
          camera.updateProjectionMatrix();
        };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          fit();
          controls.update();
          if (camera.position.y < 0.1) camera.position.y = 0.1;
          renderer.render(scene, camera);
        };

        const clampHalf = (v: number, half: number) => Math.min(half, Math.max(-half, v));
        apiRef.current = {
          rebuild: rebuildScene,
          applySelection,
          applyTool,
          applySnap,
          viewCenter() {
            const cur = specRef.current;
            return [
              Math.round(clampHalf(controls.target.x, cur.bounds.x / 2) * 10) / 10,
              Math.round(clampHalf(controls.target.z, cur.bounds.z / 2) * 10) / 10,
            ];
          },
          viewPose() {
            const r3 = (n: number) => Math.round(n * 1000) / 1000;
            return {
              position: [r3(camera.position.x), r3(camera.position.y), r3(camera.position.z)],
              target: [r3(controls.target.x), r3(controls.target.y), r3(controls.target.z)],
              fovDeg: Math.round(camera.fov * 100) / 100,
            };
          },
        };

        rebuildScene(spec0);
        fit();
        raf = requestAnimationFrame(loop);
        setReady(true);

        cleanup = () => {
          cancelAnimationFrame(raf);
          canvas.removeEventListener("pointerdown", onDown);
          canvas.removeEventListener("pointerup", onUp);
          clearOutline();
          clearHandles();
          disposeBuilt();
          tc.dispose();
          controls.dispose();
          handleGeo.dispose();
          camGeo.dispose();
          handleMat.dispose();
          lineMat.dispose();
          renderer.dispose();
          canvas.remove();
          apiRef.current = null;
        };
      } catch (err) {
        console.error("SetEditor could not open:", err);
        setLoadFailed(true);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // The stage opens once; every later change reaches it through apiRef.
  }, []);

  // What the engine and the keyboard call, kept current each render.
  useEffect(() => {
    pickRef.current = (next) => setSel(next);
    gizmoRef.current = handleGizmo;
    undoRef.current = undo;
    redoRef.current = redo;
    deleteRef.current = removeSelected;
    addOpenRef.current = addOpen;
  });

  useEffect(() => {
    selRef.current = sel;
    apiRef.current?.applySelection(sel);
  }, [sel, ready]);

  useEffect(() => {
    toolRef.current = tool;
    apiRef.current?.applyTool(tool);
  }, [tool, ready]);

  useEffect(() => {
    snapRef.current = snap;
    apiRef.current?.applySnap(snap);
  }, [snap, ready]);

  // ⌘Z / ⇧⌘Z / Delete / Escape, when no field holds the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteRef.current();
      } else if (e.key === "Escape") {
        // The open menu first; the thing in hand on the next press.
        if (addOpenRef.current) setAddOpen(false);
        else pickRef.current(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A pending autosave flushes when the editor closes any way at all.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      void saveSetEdit(setId, specRef.current);
    };
  }, [setId]);

  // ---- what the panels say ----
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const shapeName = (shape: SetShape) => s.editorShapes[shape];
  const lightKindName = (kind: SetLightKind) => s.editorLights[kind];
  const lightName = (li: number) => {
    const kind = spec.lights[li].kind;
    const before = spec.lights.slice(0, li).filter((l) => l.kind === kind).length;
    const total = spec.lights.filter((l) => l.kind === kind).length;
    return total > 1 ? `${lightKindName(kind)} ${before + 1}` : lightKindName(kind);
  };
  const objectName = (o: SetObject) => `${shapeName(o.shape)} · ${r1(o.size[0])}×${r1(o.size[1])}×${r1(o.size[2])}`;
  const markName = (mi: number) => spec.marks[mi].label || formatMsg(s.editorMarkN, { n: mi + 1 });
  const cameraName = (ci: number) => spec.cameras[ci].label || formatMsg(s.editorCameraN, { n: ci + 1 });
  const selName = !sel
    ? s.editorSetItself
    : sel.kind === "object"
      ? objectName(spec.objects[sel.index])
      : sel.kind === "light"
        ? lightName(sel.index)
        : sel.kind === "mark"
          ? markName(sel.index)
          : sel.kind === "camera"
            ? cameraName(sel.index)
            : sel.kind === "sky"
              ? s.editorSky
              : sel.kind === "ground"
                ? s.editorGround
                : s.editorFog;
  const isSame = (a: EditTarget | null, b: EditTarget) =>
    a !== null && a.kind === b.kind && ("index" in a ? a.index : -1) === ("index" in b ? b.index : -1);
  const saveLine =
    saveState === "saving" ? s.editorSaving : saveState === "failed" ? s.editorSaveFailed : saveState === "saved" ? s.editorSaved : "";
  const toolName =
    tool === "select" ? s.editorToolSelect : tool === "move" ? s.editorToolMove : tool === "rotate" ? s.editorToolRotate : s.editorToolScale;

  const selObject = sel?.kind === "object" ? spec.objects[sel.index] : null;
  const selLight = sel?.kind === "light" ? spec.lights[sel.index] : null;
  const selMark = sel?.kind === "mark" ? spec.marks[sel.index] : null;
  const selCamera = sel?.kind === "camera" ? spec.cameras[sel.index] : null;
  const selRepeat = selObject?.repeat ?? null;
  const fogNow = spec.fog;
  const C = SET_LIMITS.maxCoordinate;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#141519] font-sans text-[13px] leading-[18px] text-[#c6c9d1]" data-set-editor>
      {/* A phone held upright has no room for a rail, a canvas and a 300 px
          panel: it is told so, with the way back, rather than handed an
          editor it cannot see. Turned sideways, most phones clear it. */}
      <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-[#141519] px-8 text-center sm:hidden">
        <p className="max-w-xs text-[14px] leading-[21px] text-[#c6c9d1]">{s.editorNarrow}</p>
        <button
          type="button"
          onClick={() => void done()}
          className="flex h-9 cursor-pointer items-center rounded-[8px] bg-[#e0a468] px-4 text-[13px] font-semibold text-[#1b1c20]"
        >
          {s.editorDone}
        </button>
      </div>
      {/* app bar */}
      <div className={`${BAR} flex h-12 flex-none items-center gap-3 border-b ${HAIR} px-3.5`}>
        <span className="relative font-display text-[16px] font-bold text-[#ecedf1]">
          P<span aria-hidden className="absolute -bottom-0.5 left-px right-px h-[2px] bg-atelier-accent" />
        </span>
        <span aria-hidden className="h-5 w-px bg-white/[0.09]" />
        <span className="text-[12px] text-[#6b6f7a]">{s.eyebrow}</span>
        <h1 className="min-w-0 truncate font-display text-[14px] font-semibold text-[#ecedf1]">{spec.title || s.untitled}</h1>
        <span className="flex-1" />
        <span className="flex h-7 items-center gap-0.5 rounded-[6px] bg-white/[0.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <span className="flex h-6 cursor-default items-center rounded-[4px] bg-[#2a2b33] px-3.5 text-[12px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
            {s.editorBuildTab}
          </span>
          <button type="button" onClick={() => void done()} className="flex h-6 cursor-pointer items-center rounded-[4px] px-3.5 text-[12px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]">
            {s.editorShootTab}
          </button>
        </span>
        <span className="flex-1" />
        <button type="button" onClick={undo} disabled={at === 0} className={ICON_BTN} title={s.editorUndo} aria-label={s.editorUndo}>
          <Svg d={D.undo} className="h-[15px] w-[15px]" />
        </button>
        <button type="button" onClick={redo} disabled={at >= history.length - 1} className={ICON_BTN} title={s.editorRedo} aria-label={s.editorRedo}>
          <Svg d={D.redo} className="h-[15px] w-[15px]" />
        </button>
        <span className="text-[12px] tabular-nums text-[#9aa0ad]">{formatMsg(s.editorEditN, { n: at })}</span>
        <span aria-hidden className="h-5 w-px bg-white/[0.09]" />
        <span className="text-[12px] text-[#6b6f7a]">{saveLine}</span>
        <button
          type="button"
          onClick={() => void restoreOriginal()}
          className="cursor-pointer text-[12px] text-[#9aa0ad] hover:text-[#ecedf1]"
          title={s.editorOriginalHint}
        >
          {s.editorOriginal}
        </button>
        <button
          type="button"
          onClick={() => void done()}
          className="flex h-7 cursor-pointer items-center rounded-[6px] bg-[#e0a468] px-3.5 text-[12px] font-semibold text-[#1b1c20]"
        >
          {s.editorDone}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch">
        {/* tool rail */}
        <div className={`${PANEL} relative flex w-12 flex-none flex-col items-center gap-1 border-r ${HAIR} py-2.5`}>
          {(
            [
              ["select", D.select, s.editorToolSelect],
              ["move", D.move, s.editorToolMove],
              ["rotate", D.rotate, s.editorToolRotate],
              ["scale", D.scale, s.editorToolScale],
            ] as const
          ).map(([id, d, name]) => (
            <button key={id} type="button" onClick={() => setTool(id)} className={tool === id ? TOOL_ON : TOOL_BTN} title={name} aria-label={name}>
              <Svg d={d} />
            </button>
          ))}
          <span aria-hidden className="my-1 h-px w-6 bg-white/[0.08]" />
          <button type="button" onClick={() => setAddOpen((v) => !v)} className={addOpen ? TOOL_ON : TOOL_BTN} title={s.editorAdd} aria-label={s.editorAdd}>
            <Svg d={D.add} />
          </button>
          {/* A click anywhere off the menu closes it, as the page's other menus do. */}
          {addOpen && <div aria-hidden className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />}
          {addOpen && (
            <div className={`absolute left-12 top-40 z-20 flex min-w-[12rem] flex-col gap-0.5 rounded-[10px] border ${HAIR} ${PANEL} p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]`}>
              {SET_SHAPES.map((shape) => (
                <button key={shape} type="button" onClick={() => addThing(shape)} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#c6c9d1] hover:bg-white/[0.05]">
                  <Svg d={D.cube} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                  {shapeName(shape)}
                </button>
              ))}
              <span aria-hidden className="mx-2 my-1 h-px bg-white/[0.08]" />
              <button type="button" onClick={addALight} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#c6c9d1] hover:bg-white/[0.05]">
                <Svg d={D.bulb} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                {s.editorAddLight}
              </button>
              <button type="button" onClick={addAMark} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#c6c9d1] hover:bg-white/[0.05]">
                <Svg d={D.person} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                {s.editorAddMark}
              </button>
              <button type="button" onClick={addACamera} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#c6c9d1] hover:bg-white/[0.05]">
                <Svg d={D.camera} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                {s.editorAddCamera}
              </button>
            </div>
          )}
        </div>

        {/* canvas column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* context bar */}
          <div className={`${BAR} flex h-9 flex-none items-center gap-2 border-b ${HAIR} px-3`}>
            <span className="text-[12px] font-semibold text-[#ecedf1]">{toolName}</span>
            <span className="min-w-0 truncate text-[11px] text-[#6b6f7a]">{selName}</span>
            {selObject && sel?.kind === "object" && (
              <>
                <span aria-hidden className="mx-1 h-[18px] w-px bg-white/[0.09]" />
                <span className="w-72 flex-none">
                  <Vec3Row value={selObject.position} min={-C} max={C} onCommit={(v) => commit(patchObject(spec, sel.index, { position: v }))} />
                </span>
                <button
                  type="button"
                  onClick={() => commit(patchObject(spec, sel.index, { position: [selObject.position[0], selObject.size[1] / 2, selObject.position[2]] }))}
                  className="cursor-pointer whitespace-nowrap text-[11px] text-[#9aa0ad] hover:text-[#ecedf1]"
                >
                  {s.editorRestGround}
                </button>
              </>
            )}
            <span aria-hidden className="mx-1 h-[18px] w-px bg-white/[0.09]" />
            <Check on={snap} onToggle={() => setSnap((v) => !v)}>
              {s.editorSnap}
            </Check>
            <span className="flex-1" />
            {flash && <span className="min-w-0 truncate text-[11px] text-[#e0a468]">{flash}</span>}
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[#6b6f7a]">
              {formatMsg(s.editorCounts, { things: spec.objects.length, shapes: specInstanceCount(spec), max: SET_LIMITS.maxInstances })}
            </span>
          </div>

          {/* the stage */}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#101116]">
            <div ref={hostRef} className="absolute inset-0" />
            {!ready && !loadFailed && (
              <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] text-[#6b6f7a]">{s.editorLoading}</p>
            )}
            {loadFailed && (
              <p className="absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 text-center text-[12px] text-[#9aa0ad]">
                {s.editorLoadFailed}
              </p>
            )}
            <span className="pointer-events-none absolute bottom-4 left-3 rounded-[6px] border border-white/[0.09] bg-[rgba(20,21,25,0.85)] px-2.5 py-1 text-[11px] text-[#9aa0ad]">
              {s.editorOrbitHint}
            </span>

            {/* Astra's prompt bar */}
            <div className="absolute bottom-4 left-1/2 w-[560px] max-w-[calc(100%-2rem)] -translate-x-1/2">
              {(askNote !== null || askError || asking || astraTooBig) && (
                <div className="mx-auto mb-2 flex w-fit max-w-full items-center gap-2 rounded-[8px] border border-white/[0.11] bg-[rgba(25,26,32,0.94)] px-3 py-1.5 text-[12px] text-[#c6c9d1] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
                  {asking ? (
                    <span>{s.editorAsking}</span>
                  ) : askError ? (
                    <span className="text-red-400">{localizeServerText(askError, t)}</span>
                  ) : askNote === null ? (
                    <span className="text-[#9aa0ad]">{localizeServerText(SET_EDIT_TOO_BIG, t)}</span>
                  ) : askNote === 0 ? (
                    <span>{s.editorAskNothing}</span>
                  ) : (
                    <>
                      <span>{askNote === 1 ? s.editorAskDoneOne : formatMsg(s.editorAskDone, { n: askNote ?? 0 })}</span>
                      <button type="button" onClick={undo} className="cursor-pointer font-medium text-[#e0a468]">
                        {s.editorUndo}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="flex h-11 items-center gap-2.5 rounded-[10px] border border-white/[0.11] bg-[rgba(25,26,32,0.94)] pl-3 pr-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]">
                <span className="relative inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] bg-[#ecedf1] font-display text-[12px] font-bold text-[#1b1c20]">
                  A<span aria-hidden className="absolute bottom-[3px] left-[5px] right-[5px] h-[1.5px] bg-atelier-accent" />
                </span>
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendAsk();
                    }
                  }}
                  placeholder={s.editorAskPlaceholder}
                  disabled={asking}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#ecedf1] outline-none placeholder:text-[#6b6f7a] disabled:opacity-60"
                />
                {editsLeft !== null && (
                  <span title={s.editorAskLeftTitle} className="flex-none whitespace-nowrap text-[11px] tabular-nums text-[#6b6f7a]">
                    {editsLeft === 0 ? s.editorAskLeftNone : editsLeft === 1 ? s.editorAskLeftOne : formatMsg(s.editorAskLeft, { n: editsLeft })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void sendAsk()}
                  disabled={asking || ask.trim().length === 0 || editsLeft === 0 || astraTooBig}
                  className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[7px] bg-[#e0a468] text-[#1b1c20] disabled:cursor-default disabled:bg-white/[0.06] disabled:text-[#9aa0ad]"
                  aria-label={s.editorAskSend}
                >
                  {asking ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <Svg d="M12 19V5|M6 11l6-6 6 6" className="h-[15px] w-[15px]" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* scene + properties */}
        <div className={`${PANEL} flex w-[300px] flex-none flex-col border-l ${HAIR} min-h-0`}>
          <div className={`${PHEAD} border-b ${HAIR}`}>{s.editorScene}</div>
          <div className="min-h-0 flex-[0_0_auto] max-h-[44%] overflow-y-auto py-1">
            <TreeRow icon="sun" name={s.editorEnvironment} selected={false} onPick={() => setSel(null)} />
            <TreeRow icon="sky" child name={`${s.editorSky} — ${s.editorSkyKinds[spec.sky.kind]}`} selected={sel?.kind === "sky"} onPick={() => setSel({ kind: "sky" })} />
            <TreeRow dot={spec.ground.color} child name={s.editorGround} selected={sel?.kind === "ground"} onPick={() => setSel({ kind: "ground" })} />
            <TreeRow
              icon="sky"
              child
              name={`${s.editorFog}${spec.fog ? "" : ` — ${s.editorNone}`}`}
              selected={sel?.kind === "fog"}
              onPick={() => setSel({ kind: "fog" })}
            />
            {spec.lights.map((l, li) => (
              <TreeRow
                key={`l${li}`}
                icon={l.kind === "sun" ? "sun" : "bulb"}
                child
                name={lightName(li)}
                badge={String(r1(l.intensity))}
                selected={isSame(sel, { kind: "light", index: li })}
                onPick={() => setSel({ kind: "light", index: li })}
              />
            ))}
            <div className={SHEAD}>{s.editorThings}</div>
            {spec.objects.map((o, oi) => (
              <TreeRow
                key={`o${oi}`}
                dot={o.color}
                child
                name={objectName(o)}
                badge={o.repeat ? `×${o.repeat.count}` : undefined}
                selected={isSame(sel, { kind: "object", index: oi })}
                onPick={() => setSel({ kind: "object", index: oi })}
              />
            ))}
            <div className={SHEAD}>{s.editorMarks}</div>
            {spec.marks.map((m, mi) => (
              <TreeRow
                key={`m${mi}`}
                icon="person"
                child
                name={markName(mi)}
                selected={isSame(sel, { kind: "mark", index: mi })}
                onPick={() => setSel({ kind: "mark", index: mi })}
              />
            ))}
            <div className={SHEAD}>{s.editorCameras}</div>
            {spec.cameras.map((c, ci) => (
              <TreeRow
                key={`c${ci}`}
                icon="camera"
                child
                name={cameraName(ci)}
                badge={`${Math.round(c.fovDeg)}°`}
                selected={isSame(sel, { kind: "camera", index: ci })}
                onPick={() => setSel({ kind: "camera", index: ci })}
              />
            ))}
          </div>

          <div className={`${PHEAD} border-b border-t ${HAIR}`}>{s.editorProperties}</div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-3">
            <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
              <span className="min-w-0 truncate text-[13px] font-semibold text-[#ecedf1]">{selName}</span>
              <span className="flex-1" />
              {sel?.kind === "object" && (
                <button type="button" onClick={duplicateSelected} className={ICON_BTN} title={s.editorDuplicate} aria-label={s.editorDuplicate}>
                  <Svg d={D.copy} className="h-[14px] w-[14px]" />
                </button>
              )}
              {sel && "index" in sel && (
                <button type="button" onClick={removeSelected} className={ICON_BTN} title={s.editorRemove} aria-label={s.editorRemove}>
                  <Svg d={D.trash} className="h-[14px] w-[14px]" />
                </button>
              )}
            </div>

            {selObject && sel?.kind === "object" && (
              <>
                <div className={SHEAD}>{s.editorToolMove}</div>
                <PRow label={s.editorPosition}>
                  <Vec3Row value={selObject.position} min={-C} max={C} onCommit={(v) => commit(patchObject(spec, sel.index, { position: v }))} />
                </PRow>
                <PRow label={s.editorRotation}>
                  <Vec3Row value={selObject.rotation} min={-360} max={360} onCommit={(v) => commit(patchObject(spec, sel.index, { rotation: v }))} />
                </PRow>
                <PRow label={s.editorSizeRow}>
                  <Vec3Row
                    value={selObject.size}
                    min={SET_LIMITS.minSize}
                    max={SET_LIMITS.maxSize}
                    axes={["W", "H", "D"]}
                    onCommit={(v) => commit(patchObject(spec, sel.index, { size: v }))}
                  />
                </PRow>
                <div className={SHEAD}>{s.editorColor}</div>
                <PRow label={s.editorColor}>
                  <ColorField value={selObject.color} onCommit={(v) => commit(patchObject(spec, sel.index, { color: v }))} />
                </PRow>
                <PRow label={s.editorRoughness}>
                  <Slider value={selObject.roughness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchObject(spec, sel.index, { roughness: v }))} />
                </PRow>
                <PRow label={s.editorMetallic}>
                  <Slider value={selObject.metalness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchObject(spec, sel.index, { metalness: v }))} />
                </PRow>
                <PRow label={s.editorGlow}>
                  {selObject.emissive ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <ColorField value={selObject.emissive} onCommit={(v) => commit(patchObject(spec, sel.index, { emissive: v }))} />
                      <Num
                        value={selObject.emissiveIntensity}
                        min={0}
                        max={10}
                        onCommit={(v) => commit(patchObject(spec, sel.index, { emissiveIntensity: v }))}
                        className="w-12 flex-none"
                      />
                      <button
                        type="button"
                        onClick={() => commit(patchObject(spec, sel.index, { emissive: null }))}
                        className="cursor-pointer text-[11px] text-[#9aa0ad] hover:text-[#ecedf1]"
                      >
                        {s.editorNone}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => commit(patchObject(spec, sel.index, { emissive: selObject.color, emissiveIntensity: 1 }))}
                      className="cursor-pointer text-[12px] text-[#e0a468]"
                    >
                      + {s.editorGlow}
                    </button>
                  )}
                </PRow>
                <div className={SHEAD}>{s.editorRepeat}</div>
                <div className="px-3 py-1">
                  <Check
                    on={selObject.repeat !== null}
                    onToggle={() =>
                      commit(
                        patchObject(spec, sel.index, {
                          repeat: selObject.repeat ? null : { count: 4, offset: [Math.max(1, selObject.size[0] + 0.5), 0, 0] },
                        }),
                      )
                    }
                  >
                    {s.editorRepeat}
                  </Check>
                </div>
                {selRepeat && (
                  <>
                    <PRow label={s.editorRepeatCount}>
                      <Num
                        value={selRepeat.count}
                        min={2}
                        max={SET_LIMITS.maxRepeat}
                        onCommit={(v) => commit(patchObject(spec, sel.index, { repeat: { count: Math.round(v), offset: selRepeat.offset } }))}
                        className="w-16 flex-none"
                      />
                    </PRow>
                    <PRow label={s.editorRepeatOffset}>
                      <Vec3Row
                        value={selRepeat.offset}
                        min={-SET_LIMITS.maxRepeatOffset}
                        max={SET_LIMITS.maxRepeatOffset}
                        onCommit={(v) => commit(patchObject(spec, sel.index, { repeat: { count: selRepeat.count, offset: v } }))}
                      />
                    </PRow>
                  </>
                )}
                <div className="px-3 py-1.5">
                  <Check on={selObject.castShadow} onToggle={() => commit(patchObject(spec, sel.index, { castShadow: !selObject.castShadow }))}>
                    {s.editorShadow}
                  </Check>
                </div>
                {selObject.shape === "torus" && <p className="px-3 pt-1 text-[11px] text-[#6b6f7a]">{s.editorTorusSize}</p>}
              </>
            )}

            {selLight && sel?.kind === "light" && (
              <>
                <div className={SHEAD}>{s.editorKind}</div>
                <PRow label={s.editorKind}>
                  <span className="text-[12px] text-[#ecedf1]">{lightKindName(selLight.kind)}</span>
                </PRow>
                <PRow label={s.editorColor}>
                  <ColorField value={selLight.color} onCommit={(v) => commit(patchLight(spec, sel.index, { color: v }))} />
                </PRow>
                <PRow label={s.editorIntensity}>
                  <Slider
                    value={selLight.intensity}
                    min={0}
                    max={selLight.kind === "ambient" || selLight.kind === "hemisphere" ? 5 : selLight.kind === "sun" ? 10 : 500}
                    step={0.1}
                    onCommit={(v) => commit(patchLight(spec, sel.index, { intensity: v }))}
                  />
                </PRow>
                {selLight.kind !== "ambient" && selLight.kind !== "hemisphere" && (
                  <PRow label={s.editorPosition}>
                    <Vec3Row value={selLight.position} min={-C} max={C} onCommit={(v) => commit(patchLight(spec, sel.index, { position: v }))} />
                  </PRow>
                )}
                {(selLight.kind === "sun" || selLight.kind === "spot") && (
                  <PRow label={s.editorPointsAt}>
                    <Vec3Row value={selLight.target} min={-C} max={C} onCommit={(v) => commit(patchLight(spec, sel.index, { target: v }))} />
                  </PRow>
                )}
                {selLight.kind === "spot" && (
                  <>
                    <PRow label={s.editorConeAngle}>
                      <Slider value={selLight.angleDeg} min={5} max={80} step={1} onCommit={(v) => commit(patchLight(spec, sel.index, { angleDeg: v }))} />
                    </PRow>
                    <PRow label={s.editorReach}>
                      <Num value={selLight.distance} min={0} max={500} unit="m" onCommit={(v) => commit(patchLight(spec, sel.index, { distance: v }))} className="w-24 flex-none" />
                    </PRow>
                  </>
                )}
                {selLight.kind === "point" && (
                  <PRow label={s.editorReach}>
                    <Num value={selLight.distance} min={0} max={500} unit="m" onCommit={(v) => commit(patchLight(spec, sel.index, { distance: v }))} className="w-24 flex-none" />
                  </PRow>
                )}
                {selLight.kind === "hemisphere" && (
                  <PRow label={s.editorGroundBounce}>
                    <ColorField value={selLight.groundColor ?? spec.ground.color} onCommit={(v) => commit(patchLight(spec, sel.index, { groundColor: v }))} />
                  </PRow>
                )}
              </>
            )}

            {selMark && sel?.kind === "mark" && (
              <>
                <PRow label={s.editorPosition}>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Num ax="X" value={selMark.x} min={-C} max={C} onCommit={(v) => commit(patchMark(spec, sel.index, { x: v }))} />
                    <Num ax="Z" value={selMark.z} min={-C} max={C} onCommit={(v) => commit(patchMark(spec, sel.index, { z: v }))} />
                  </span>
                </PRow>
                <PRow label={s.editorFacing}>
                  <Num value={selMark.facingDeg} min={0} max={360} unit="°" onCommit={(v) => commit(patchMark(spec, sel.index, { facingDeg: v }))} className="w-24 flex-none" />
                </PRow>
              </>
            )}

            {selCamera && sel?.kind === "camera" && (
              <>
                <PRow label={s.editorPosition}>
                  <Vec3Row value={selCamera.position} min={-C} max={C} onCommit={(v) => commit(patchCamera(spec, sel.index, { position: v }))} />
                </PRow>
                <PRow label={s.editorPointsAt}>
                  <Vec3Row value={selCamera.target} min={-C} max={C} onCommit={(v) => commit(patchCamera(spec, sel.index, { target: v }))} />
                </PRow>
                <PRow label={s.editorFieldOfView}>
                  <Slider value={selCamera.fovDeg} min={SET_LIMITS.minLayoutFovDeg} max={SET_LIMITS.maxFovDeg} step={1} onCommit={(v) => commit(patchCamera(spec, sel.index, { fovDeg: v }))} />
                </PRow>
                <div className="px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const pose = apiRef.current?.viewPose();
                      if (pose) commit(patchCamera(spec, sel.index, pose));
                    }}
                    className="cursor-pointer text-[12px] text-[#e0a468]"
                  >
                    {s.editorFromThisView}
                  </button>
                </div>
              </>
            )}

            {(!sel || sel.kind === "sky" || sel.kind === "ground" || sel.kind === "fog") && (
              <>
                {(!sel || sel.kind === "sky") && (
                  <>
                    <div className={SHEAD}>{s.editorSky}</div>
                    <div className="flex items-center gap-1.5 px-3 py-1">
                      {SET_SKY_KINDS.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => commit(patchSky(spec, { kind }))}
                          className={`h-6 cursor-pointer rounded-full px-2.5 text-[11px] font-medium ${
                            spec.sky.kind === kind
                              ? "bg-[rgba(224,164,104,0.13)] text-[#e0a468] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.45)]"
                              : "bg-white/[0.05] text-[#9aa0ad]"
                          }`}
                        >
                          {s.editorSkyKinds[kind]}
                        </button>
                      ))}
                    </div>
                    {spec.sky.colors.map((c, i) => (
                      <PRow key={`sky${i}`} label={i === 0 ? s.editorColor : ""}>
                        <ColorField
                          value={c}
                          onCommit={(v) => {
                            const colors = [...spec.sky.colors];
                            colors[i] = v;
                            commit(patchSky(spec, { colors }));
                          }}
                        />
                      </PRow>
                    ))}
                  </>
                )}
                {(!sel || sel.kind === "ground") && (
                  <>
                    <div className={SHEAD}>{s.editorGround}</div>
                    <PRow label={s.editorColor}>
                      <ColorField value={spec.ground.color} onCommit={(v) => commit(patchGround(spec, { color: v }))} />
                    </PRow>
                    <PRow label={s.editorRoughness}>
                      <Slider value={spec.ground.roughness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchGround(spec, { roughness: v }))} />
                    </PRow>
                  </>
                )}
                {(!sel || sel.kind === "fog") && (
                  <>
                    <div className={SHEAD}>{s.editorFog}</div>
                    <div className="px-3 py-1">
                      <Check
                        on={spec.fog !== null}
                        onToggle={() =>
                          commit(
                            patchFog(
                              spec,
                              spec.fog ? null : { color: spec.sky.colors[spec.sky.colors.length - 1], near: 10, far: Math.max(40, spec.bounds.x) },
                            ),
                          )
                        }
                      >
                        {s.editorFog}
                      </Check>
                    </div>
                    {fogNow && (
                      <>
                        <PRow label={s.editorColor}>
                          <ColorField value={fogNow.color} onCommit={(v) => commit(patchFog(spec, { ...fogNow, color: v }))} />
                        </PRow>
                        <PRow label={s.editorFogNearFar}>
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <Num value={fogNow.near} min={0} max={1000} onCommit={(v) => commit(patchFog(spec, { ...fogNow, near: v }))} />
                            <Num value={fogNow.far} min={1} max={2000} onCommit={(v) => commit(patchFog(spec, { ...fogNow, far: v }))} />
                          </span>
                        </PRow>
                      </>
                    )}
                  </>
                )}
                {!sel && (
                  <>
                    <div className={SHEAD}>{s.editorBoundsRow}</div>
                    <p className="px-3 py-1 text-[12px] tabular-nums text-[#c6c9d1]">
                      {formatMsg(s.editorBoundsTall, { x: r1(spec.bounds.x), z: r1(spec.bounds.z), h: r1(spec.bounds.height) })}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* status bar */}
      <div className={`${BAR} flex h-6 flex-none items-center gap-4 border-t ${HAIR} px-3.5 text-[11px] text-[#6b6f7a]`}>
        <span className="tabular-nums">{formatMsg(s.editorBoundsTall, { x: r1(spec.bounds.x), z: r1(spec.bounds.z), h: r1(spec.bounds.height) })}</span>
        <span className="hidden sm:inline">{s.editorYourCopy}</span>
        <span className="flex-1" />
        <span className="hidden md:inline">{s.editorRules}</span>
      </div>
    </div>
  );
}
