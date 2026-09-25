"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { formatMsg } from "@/lib/i18n/format";
import { clearSetEdit, editSetWithAstra, readAstraEdit, saveSetEdit } from "@/lib/sets/editor-actions";
import { followAstraEdit, type FollowedEdit } from "@/lib/sets/astra-follow";
import { newPressId } from "@/lib/sets/press-follow";
import { SET_EDIT_TOO_BIG, SET_SAVE_FAILED } from "@/lib/sets/messages";
import { SET_EDIT_MAX_SPEC_CHARS } from "@/lib/sets/set-config";
import { dropUnsaved, keepUnsaved, savedEditKey, takeUnsaved } from "@/lib/sets/unsaved";
import {
  addCamera,
  addKit,
  addLight,
  addMark,
  addObject,
  patchCamera,
  patchFog,
  patchGround,
  patchLight,
  patchMark,
  patchObject,
  patchSky,
  duplicateObject,
  type EditResult,
  type EditTarget,
  removeCamera,
  removeLight,
  removeMark,
  removeObject,
  selectionAfter,
  sizeFromScale,
} from "@/lib/sets/editor-model";
import {
  normaliseSetSpec,
  SET_LIMITS,
  SET_MATERIALS,
  SET_SHAPES,
  SET_SKY_KINDS,
  specInstanceCount,
  type SetLightKind,
  type SetMaterial,
  type SetObject,
  type SetShape,
  type SetSpec,
  type Vec3,
} from "@/lib/sets/set-spec";
import type { StageQuality } from "@/lib/sets/build-scene";
import { groundMaterialOf, materialOf } from "@/lib/sets/stage-materials";
import { KELVIN_MAX, KELVIN_MIN, KELVIN_STEP, kelvinToHex, nearestKelvin } from "@/lib/sets/light-kelvin";
import { VIEW_MODES, viewModeMaterial, type ViewMode } from "@/lib/sets/view-modes";
import { dockTabsFor, railToolForKey, type DockTab, type RailTool } from "@/lib/sets/studio";
import { measureMetres, type MeasurePoint } from "@/lib/sets/furniture";
import { SceneTree } from "./scene-tree";
import { StudioBar, StudioDock, StudioRail, StudioStatus } from "./studio-frame";
import { KIT_KINDS, type KitKind } from "@/lib/sets/kit";
import { checkSet, type SetFinding } from "@/lib/sets/set-check";

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

type Tool = "select" | "move" | "rotate" | "scale" | "measure";
/** The rail's name for the editor's tool (studio.ts): Turn is rotate, Size is scale. */
const RAIL_OF_TOOL: Record<Tool, RailTool> = { select: "select", move: "move", rotate: "turn", scale: "size", measure: "measure" };

type GizmoChange = {
  position?: Vec3;
  rotationDeg?: Vec3;
  /**
   * The way the thing now faces, degrees, 0 along +Z as a mark's facing is
   * read (build-scene placeStandIn). Taken from the direction it points
   * rather than the euler's Y: three re-reads a quaternion as an XYZ euler,
   * which keeps Y within ±90° and puts the rest into X and Z, so a mark
   * facing 135° came back facing 45° (found reviewing Helios, 2026-09-17).
   */
  facingDeg?: number;
  scale?: { x: number; y: number; z: number };
};

type EditorApi = {
  rebuild(spec: SetSpec): void;
  applySelection(sel: EditTarget | null): void;
  applyTool(tool: Tool): void;
  /** The measure tool (cut C): the line's SVG and its points on the ground, moved by the loop. */
  setMeasure(svg: SVGSVGElement | null, points: readonly MeasurePoint[], words: (metres: number) => string): void;
  applySnap(on: boolean): void;
  /** Build's viewport mode (view-modes.ts): the scene's override material. */
  setViewMode(mode: ViewMode): void;
  viewCenter(): [number, number];
  viewPose(): { position: Vec3; target: Vec3; fovDeg: number };
};

// ---- the skin: one dark look in both themes, like the stage ----
const ACCENT = "#e0a468";
const BAR = "bg-[#191a20]";
const PANEL = "bg-[#1f2026]";
const HAIR = "border-[rgba(255,255,255,0.07)]";
const FLD =
  "h-6 w-full min-w-0 rounded-[4px] border-0 bg-[#141519] px-1.5 text-right text-[11.5px] tabular-nums text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] outline-none focus:shadow-[inset_0_0_0_1px_#e0a468]";
const TOOL_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-[#d6d9e0] hover:text-[#ecedf1]";
const TOOL_ON = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] bg-[rgba(224,164,104,0.13)] text-[#e0a468]";
const ICON_BTN =
  "inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[5px] text-[#d6d9e0] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100";
const PHEAD =
  "flex h-8 flex-none items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#c6c9d1]";
const SHEAD = "flex h-6 items-center px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]";
const ROW_LABEL = "w-[58px] flex-none text-[11px] text-[#c6c9d1]";

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
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  ax?: string;
  unit?: string;
  className?: string;
  /** Its own name, where it sits outside a row (the context bar). */
  label?: string;
}) {
  const row = useContext(RowLabel);
  const name = [label ?? row, ax].filter(Boolean).join(" ");
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
      {ax && <span className="text-[9.5px] font-semibold text-[#9aa0ad]">{ax}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={name || undefined}
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

/**
 * The row a field sits in, so the fields can name themselves. The
 * inspector's numbers, sliders and colours are bare inputs under a <span>
 * that only LOOKS like a label, so a screen reader read every one of them as
 * "edit text" (found reviewing Helios, fixed 2026-09-18). PRow provides its
 * words; a number adds its axis.
 */
const RowLabel = createContext("");

function Vec3Row({
  value,
  onCommit,
  min,
  max,
  axes = ["X", "Y", "Z"],
  label,
}: {
  value: Vec3;
  onCommit: (v: Vec3) => void;
  min?: number;
  max?: number;
  axes?: [string, string, string];
  /** Its own name, where the row is not one (the context bar). */
  label?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {([0, 1, 2] as const).map((i) => (
        <Num
          key={axes[i]}
          label={label}
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
function ColorField({ value, onCommit, hexLabel }: { value: string; onCommit: (v: string) => void; hexLabel: string }) {
  const row = useContext(RowLabel);
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
          aria-label={row || undefined}
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
        aria-label={row ? `${row} ${hexLabel}` : hexLabel}
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
  const row = useContext(RowLabel);
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
        aria-label={row || undefined}
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
    <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className="flex cursor-pointer items-center gap-2 text-[12px] text-[#d6d9e0]">
      <span
        className={`inline-flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] ${on ? "bg-[#e0a468] text-[#1b1c20]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"}`}
      >
        {on && <Svg d={D.check} className="h-2.5 w-2.5" />}
      </span>
      {children}
    </button>
  );
}

/**
 * The material word (set-spec.ts SET_MATERIALS): a native select, the one
 * control here with more than a handful of choices. "From its colour"
 * (null) shows which word the stage infers, so choosing is a correction.
 */
function MaterialPick({
  value,
  inferred,
  onCommit,
  s,
}: {
  value: SetMaterial | null;
  inferred: SetMaterial;
  onCommit: (m: SetMaterial | null) => void;
  s: { editorMaterialAuto: string; editorMaterials: Record<SetMaterial, string> };
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onCommit((e.target.value || null) as SetMaterial | null)}
      className="h-[26px] min-w-0 flex-1 cursor-pointer rounded-[5px] bg-[#111217] px-1.5 text-[12px] text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] outline-none focus:shadow-[inset_0_0_0_1px_rgba(224,164,104,0.6)]"
    >
      <option value="">{`${s.editorMaterialAuto} · ${s.editorMaterials[inferred]}`}</option>
      {SET_MATERIALS.map((m) => (
        <option key={m} value={m}>
          {s.editorMaterials[m]}
        </option>
      ))}
    </select>
  );
}

function PRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-1.5 px-3">
      <span className={ROW_LABEL}>{label}</span>
      <RowLabel.Provider value={label}>{children}</RowLabel.Provider>
    </div>
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
  // Build's viewport mode (the studio, cut 4): Lit, Clay, Wire or Depth — this page's only.
  const [view, setView] = useState<ViewMode>("lit");
  // The scene tree's search (the outliner): rows whose name holds the words.
  const [find, setFind] = useState("");
  const [checkOpen, setCheckOpen] = useState(false);
  const [snap, setSnap] = useState(true);
  const [history, setHistory] = useState<string[]>(() => [JSON.stringify(initialEdited ?? original)]);
  /** Astra's original as the history keeps a copy, for naming the rows that hold it. */
  const originalKey = useMemo(() => JSON.stringify(original), [original]);
  /**
   * What a history row IS. Row 0 is the copy the editor opened on — Astra's
   * original only when nothing had been saved before — and the original can
   * also sit further down, put back by restoreOriginal; past sixty edits the
   * list is sliced and row 0 is neither. It was labelled by its index, so on
   * every return visit to an edited set the first row promised Astra's
   * original and restored the working copy, and the bar read "Edit 0", which
   * names nothing (found reviewing Helios, fixed 2026-09-18).
   */
  const rowLabel = (i: number) =>
    history[i] === originalKey ? s.editorOriginal : i === 0 ? s.editorOpened : formatMsg(s.editorEditN, { n: i });
  const [at, setAt] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // What the server holds, compared the way unsaved.ts compares it: the copy
  // the editor opened on, then every save that landed. dirtyRef: the copy on
  // screen is not known to be saved yet.
  const [openedKey] = useState(() => savedEditKey(initialEdited ?? original));
  const savedKeyRef = useRef(openedKey);
  const dirtyRef = useRef(false);
  // A deploy left this tab behind (stale-deploy.ts): nothing more is sent,
  // and the reload that cures it is on its way.
  const staleRef = useRef(false);
  const [flash, setFlash] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) apiRef.current?.setViewMode(view);
  }, [ready, view]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The studio's frame (studio.ts, studio-frame.tsx; cut A): the dock's
  // tab, the rail's Kit menu, the Find field's focus, the rail's actions
  // kept current for the keys.
  const [dockTab, setDockTab] = useState<DockTab>("scene");
  const [kitOpen, setKitOpen] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<(id: RailTool) => void>(() => {});
  // The measure tool (cut C): two points on the ground and the line between them.
  const [measurePts, setMeasurePts] = useState<MeasurePoint[]>([]);
  const measureAddRef = useRef<(p: MeasurePoint) => void>(() => {});
  useEffect(() => {
    measureAddRef.current = (p) => setMeasurePts((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
  }, []);
  const measureRef = useRef<SVGSVGElement>(null);
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
  const commitRef = useRef<(result: EditResult) => void>(() => {});
  const addOpenRef = useRef(false);

  function flashLine(text: string) {
    setFlash(text);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(""), 4000);
  }

  function scheduleSave(next: SetSpec) {
    setSaveState("saving");
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveCopy(next);
    }, 1200);
  }

  /**
   * A copy that did not save is kept for this tab (unsaved.ts), to come
   * back if the editor reloads. A deploy that left the tab behind
   * (stale-deploy.ts) stops the saves: the bar says so and the page
   * reloads once, keeping the copy on screen at that moment. Whether that
   * reload is on its way.
   */
  function saveMissed(copy: SetSpec, err: unknown): boolean {
    keepUnsaved(setId, "edit", copy, savedKeyRef.current);
    if (staleRef.current) return true;
    if (!isStaleDeployError(err)) return false;
    const reloading = reloadForNewDeploy({
      delayMs: 1800,
      before: () => keepUnsaved(setId, "edit", specRef.current, savedKeyRef.current),
    });
    if (!reloading) return false;
    staleRef.current = true;
    setAskError(t.generate.refreshNeeded);
    return true;
  }

  /**
   * Save `copy` as the working copy (or, with `clear`, go back to Astra's
   * original), never throwing, and say whether it landed. The header says
   * how it went; a copy that did not land is kept (saveMissed).
   */
  async function saveCopy(copy: SetSpec, clear = false): Promise<boolean> {
    if (staleRef.current) {
      saveMissed(copy, null);
      return false;
    }
    let error: string | null;
    const sentAt = new Date().getTime();
    try {
      error = (clear ? await clearSetEdit(setId) : await saveSetEdit(setId, copy)).error;
    } catch (err) {
      if (!saveMissed(copy, err)) setSaveState("failed");
      return false;
    }
    if (error !== null) {
      saveMissed(copy, null);
      setSaveState("failed");
      return false;
    }
    savedKeyRef.current = savedEditKey(copy);
    dropUnsaved(setId, "edit", sentAt);
    if (specRef.current === copy) dirtyRef.current = false;
    setSaveState("saved");
    return true;
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
    // The thing in hand stays in hand, as it does through a step of one's
    // own (goTo): a change that shortens a list — "remove the two carts" —
    // left the selection pointing past the end, and the editor threw while
    // drawing its name (found reviewing Helios, 2026-09-17). Set before the
    // rebuild, which puts the gizmo back on whatever selRef names.
    const keep = selectionAfter(selRef.current, specRef.current, next);
    selRef.current = keep;
    setSel(keep);
    // A pending save of the copy Astra was given would land on top of the
    // answer: the answer is already saved, and this is now the copy.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    applySpec(next);
    savedKeyRef.current = savedEditKey(next);
    dirtyRef.current = false;
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

  function addAProp(kind: KitKind) {
    setAddOpen(false);
    const at = apiRef.current?.viewCenter() ?? [0, 0];
    // Facing the camera, the way a mark would.
    const pose = apiRef.current?.viewPose();
    const facing = pose ? Math.round((Math.atan2(pose.position[0] - at[0], pose.position[2] - at[1]) * 180) / Math.PI) : 0;
    const r = addKit(specRef.current, kind, at, facing);
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "object", index: r.spec.objects.length - 1 });
  }
  /** The working copy as a file (cut 5): the set as JSON, for anywhere else. */
  function exportJson() {
    const blob = new Blob([JSON.stringify(specRef.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(specRef.current.title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "set"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function addAnAreaLight() {
    setAddOpen(false);
    const r = addLight(specRef.current, "area");
    if (!r.ok) {
      flashLine(s.editorFull);
      return;
    }
    commit(r);
    setSel({ kind: "light", index: r.spec.lights.length - 1 });
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
      if (change.facingDeg !== undefined) patch.facingDeg = Math.round(change.facingDeg) % 360;
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
    dirtyRef.current = true;
    await saveCopy(original, true);
  }

  /**
   * Back to shooting: whatever is not saved yet saves first, then the
   * workspace. A copy that cannot be saved is not left behind unasked (the
   * Shoot side would show the set without it): the person decides, and a
   * tab a deploy left behind stays for its reload.
   */
  async function done(to: string = closeHref) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (dirtyRef.current && !(await saveCopy(specRef.current))) {
      if (staleRef.current || !window.confirm(s.editorLeaveUnsaved)) return;
      // Left behind on purpose: it does not come back.
      dropUnsaved(setId, "edit");
    }
    router.push(to);
    router.refresh();
  }

  async function sendAsk() {
    const text = ask.trim();
    if (!text || asking || astraTooBig) return;
    // The month's changes are spent. Said here rather than sent: the server
    // refuses it anyway, but only after a gated, paid read of the words and
    // one of the pace's hits (editor-actions.ts). Send was held silently and
    // Enter was not held at all (found reviewing Helios, fixed 2026-09-18).
    if (editsLeft === 0) {
      setAskNote(null);
      setAskError(s.editorAskCapped);
      return;
    }
    setAsking(true);
    setAskError("");
    setAskNote(null);
    // Astra changes the copy the server holds: a change made by hand a
    // moment ago is saved first, or Astra would answer without it.
    if (saveTimerRef.current || dirtyRef.current) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!(await saveCopy(specRef.current))) {
        if (!staleRef.current) setAskError(SET_SAVE_FAILED);
        setAsking(false);
        return;
      }
    }
    // One id per press (astra-press.ts, 2026-09-25): a browser's silent
    // resend of this call is answered at once and never runs Astra twice.
    // newPressId, never crypto.randomUUID alone: that throws outside a
    // secure context or on an old WebView, with the editor already held
    // (review, 2026-09-25).
    const pressId = newPressId();
    const before = specRef.current;
    let r: Awaited<ReturnType<typeof editSetWithAstra>> | null = null;
    let followed: FollowedEdit | null = null;
    const askedAt = new Date().getTime();
    try {
      try {
        r = await editSetWithAstra(setId, text, pressId);
      } catch (err) {
        // A stale deploy: the bar is let go and says so. It reloads through
        // the one shared guard, and saveMissed keeps the working copy across
        // it — the reload here used to take the unsaved change with it
        // (2026-09-18).
        if (isStaleDeployError(err)) {
          saveMissed(specRef.current, err);
          setAskError(t.generate.refreshNeeded);
          return;
        }
        // A dropped connection may still have saved (Astra usually finishes
        // on the server): read back below rather than "try again", which
        // spent a second change for one that had landed.
      }
      if (r === null || (r.error !== null && r.pending)) {
        followed = await followAstraEdit(() => readAstraEdit(setId, pressId).catch((thrown: unknown) => ({ thrown })), {
          before,
          stop: (err) => {
            if (!isStaleDeployError(err)) return false;
            saveMissed(specRef.current, err);
            setAskError(t.generate.refreshNeeded);
            return true;
          },
        });
      }
    } finally {
      setAsking(false);
    }
    if (followed) {
      if (followed.kind !== "none" && followed.kind !== "left" && followed.kind !== "error" && followed.editsLeft !== undefined) setEditsLeft(followed.editsLeft);
      if (followed.kind === "saved") {
        setAsk("");
        commitFromServer(followed.spec);
        dropUnsaved(setId, "edit", askedAt);
        setAskNote(followed.changed);
      } else if (followed.kind === "none") setAskError(t.generate.submitFailed);
      else if (followed.kind !== "left") setAskError(followed.error);
      return;
    }
    if (!r) return;
    if (r.editsLeft !== undefined) setEditsLeft(r.editsLeft);
    if (r.error !== null) {
      setAskError(r.error);
      return;
    }
    setAsk("");
    commitFromServer(r.spec);
    dropUnsaved(setId, "edit", askedAt);
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
        const { Sky } = await import("three/examples/jsm/objects/Sky.js");
        const { RectAreaLightUniformsLib } = await import("three/examples/jsm/lights/RectAreaLightUniformsLib.js");
        const { makeStageTextures } = await import("@/lib/sets/stage-materials");
        if (disposed || !hostRef.current) return;
        RectAreaLightUniformsLib.init();

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
        // The same stage the shoot draws (build-scene.ts StageQuality), so
        // what is built here is what is shot: a phone keeps the basic one,
        // ?stage=basic shows it anywhere.
        const quality: StageQuality = coarse || new URLSearchParams(window.location.search).get("stage") === "basic" ? "basic" : "full";
        const textures = quality === "full" ? makeStageTextures(THREE) : null;
        const pmrem = quality === "full" ? new THREE.PMREMGenerator(renderer) : null;
        const stageOpts = { shadows, quality, textures, sky: pmrem ? { Sky, pmrem } : null };
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
        handleMat.allowOverride = false;
        lineMat.allowOverride = false;
        const handleGeo = new THREE.SphereGeometry(0.22, 16, 12);
        const camGeo = new THREE.BoxGeometry(0.4, 0.26, 0.55);

        const tc = new TransformControls(camera, canvas);
        tc.setSize(0.85);
        const gizmoHelper = tc.getHelper();
        scene.add(gizmoHelper);
        /**
         * The viewport's modes draw the SET, not the tools: three hands its
         * override material to every material that allows one, so Clay,
         * Wire and Depth painted the gizmo's axes, the outline and the
         * handles one grey and hid them inside the thing in hand (found
         * reviewing Helios, 2026-09-17).
         */
        const keepOwnColour = (root: InstanceType<typeof THREE.Object3D>) => {
          root.traverse((o) => {
            const m = (o as InstanceType<typeof THREE.Mesh>).material;
            for (const one of Array.isArray(m) ? m : m ? [m] : []) one.allowOverride = false;
          });
        };

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
          // The gizmo builds its axes lazily, so it is asked again here.
          keepOwnColour(gizmoHelper);
          spec.lights.forEach((l, li) => {
            if (l.kind === "ambient" || l.kind === "hemisphere") return;
            const h = new THREE.Mesh(handleGeo, handleMat);
            h.position.set(...l.position);
            h.userData.target = { kind: "light", index: li } satisfies EditTarget;
            handlesGroup.add(h);
            if (l.kind === "sun" || l.kind === "spot" || l.kind === "area") {
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
          keepOwnColour(handlesGroup);
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
          if (!target || !obj || nextTool === "select" || nextTool === "measure") return;
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
          keepOwnColour(outline);
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
          built = buildSetScene(THREE, spec, stageOpts);
          scene.add(built.root);
          scene.background = built.background;
          scene.fog = built.fog;
          scene.environment = built.environment;
          scene.environmentIntensity = built.environmentIntensity;
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
          if (tc.mode === "rotate") {
            change.rotationDeg = [obj.rotation.x / DEG, obj.rotation.y / DEG, obj.rotation.z / DEG];
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
            change.facingDeg = ((Math.atan2(forward.x, forward.z) / DEG) % 360 + 360) % 360;
          }
          if (tc.mode === "scale") change.scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
          gizmoRef.current(target, change);
        });

        // A click picks; a drag orbits. The gizmo's own drags never get here
        // (it captures the pointer), so only still clicks select.
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        let downAt: { x: number; y: number } | null = null;
        // The measure's line (cut C): projected onto the screen every frame.
        let measureSvg: SVGSVGElement | null = null;
        let measurePoints: readonly MeasurePoint[] = [];
        let measureWords: (metres: number) => string = (m) => `${m} m`;
        const measureV = new THREE.Vector3();
        const drawMeasure = () => {
          if (!measureSvg) return;
          const pts = measurePoints;
          measureSvg.style.display = pts.length === 0 ? "none" : "";
          if (pts.length === 0) return;
          const r = canvas.getBoundingClientRect();
          const project = (x: number, z: number) => {
            measureV.set(x, 0.02, z).project(camera);
            return { x: ((measureV.x + 1) / 2) * r.width, y: ((1 - measureV.y) / 2) * r.height };
          };
          const a = project(pts[0].x, pts[0].z);
          const line = measureSvg.querySelector<SVGLineElement>("line");
          const c1 = measureSvg.querySelector<SVGCircleElement>('[data-end="a"]');
          const c2 = measureSvg.querySelector<SVGCircleElement>('[data-end="b"]');
          const label = measureSvg.querySelector<SVGTextElement>("text");
          if (c1) {
            c1.setAttribute("cx", a.x.toFixed(1));
            c1.setAttribute("cy", a.y.toFixed(1));
          }
          if (pts.length > 1) {
            const b = project(pts[1].x, pts[1].z);
            if (line) {
              line.setAttribute("x1", a.x.toFixed(1));
              line.setAttribute("y1", a.y.toFixed(1));
              line.setAttribute("x2", b.x.toFixed(1));
              line.setAttribute("y2", b.y.toFixed(1));
              line.style.display = "";
            }
            if (c2) {
              c2.setAttribute("cx", b.x.toFixed(1));
              c2.setAttribute("cy", b.y.toFixed(1));
              c2.style.display = "";
            }
            if (label) {
              label.setAttribute("x", ((a.x + b.x) / 2).toFixed(1));
              label.setAttribute("y", ((a.y + b.y) / 2 - 8).toFixed(1));
              const text = measureWords(measureMetres(pts[0], pts[1]));
              if (label.textContent !== text) label.textContent = text;
              label.style.display = "";
            }
          } else {
            if (line) line.style.display = "none";
            if (c2) c2.style.display = "none";
            if (label) label.style.display = "none";
          }
        };
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
          // Measure (cut C): a click on the ground is a point; two make the line.
          if (toolRef.current === "measure") {
            if (raycaster.ray.intersectPlane(groundPlane, groundHit)) measureAddRef.current({ x: Math.round(groundHit.x * 100) / 100, z: Math.round(groundHit.z * 100) / 100 });
            return;
          }
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
          drawMeasure();
        };

        const clampHalf = (v: number, half: number) => Math.min(half, Math.max(-half, v));
        apiRef.current = {
          rebuild: rebuildScene,
          applySelection,
          applyTool,
          setMeasure(svg, points, words) {
            measureSvg = svg;
            measurePoints = points;
            measureWords = words;
          },
          applySnap,
          setViewMode(mode) {
            const prev = scene.overrideMaterial;
            scene.overrideMaterial = viewModeMaterial(THREE, mode);
            prev?.dispose();
          },
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
          textures?.dispose();
          pmrem?.dispose();
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
    commitRef.current = commit;
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
    if (!ready) return;
    apiRef.current?.setMeasure(measureRef.current, measurePts, (m) => formatMsg(s.studio.measure, { m }));
  }, [ready, measurePts, s]);

  useEffect(() => {
    snapRef.current = snap;
    apiRef.current?.applySnap(snap);
  }, [snap, ready]);

  useEffect(() => {
    railRef.current = (id) => {
      if (id === "select" || id === "move") setTool(id);
      else if (id === "turn") setTool("rotate");
      else if (id === "size") setTool("scale");
      else if (id === "measure") setTool("measure");
      else if (id === "camera") addACamera();
      else if (id === "light") addALight();
      else if (id === "mark") addAMark();
      else if (id === "kit") setKitOpen((v) => !v);
    };
  });
  /** Find anything (the bar, ⌘K): the dock's Scene tab with its filter in hand. */
  function openFind() {
    setDockTab("scene");
    setTimeout(() => findRef.current?.focus(), 0);
  }

  // ⌘Z / ⇧⌘Z / Delete / Escape, when no field holds the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      // A dropdown too (the Material picker): typing "c" or "m" to reach
      // concrete or metal added a camera or a mark, and Delete removed the
      // thing in hand (found reviewing Helios, 2026-09-17). The set page
      // has always skipped selects.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      } else if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openFind();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteRef.current();
      } else if (e.key === "Escape") {
        // The open menu first; the measure's line; the thing in hand on the next press.
        setKitOpen(false);
        setMeasurePts([]);
        if (addOpenRef.current) setAddOpen(false);
        else pickRef.current(null);
      } else if (!meta && !e.altKey && !e.shiftKey) {
        // The studio's keys (cut 4, then the rail in cut A — studio.ts
        // railToolForKey): V G R S pick the tool, C L M K place a camera,
        // a light, a mark, a prop; 1–4 the view.
        const k = e.key.toLowerCase();
        const railTool = railToolForKey("build", k);
        if (railTool) {
          e.preventDefault();
          railRef.current(railTool);
        } else if (k >= "1" && k <= "4") {
          e.preventDefault();
          setView(VIEW_MODES[Number(k) - 1]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A pending autosave flushes when the editor closes any way at all; one
  // that fails is kept for this tab, like any other (unsaved.ts).
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      const copy = specRef.current;
      const base = savedKeyRef.current;
      const sentAt = new Date().getTime();
      saveSetEdit(setId, copy).then(
        (r) => {
          if (r.error !== null) keepUnsaved(setId, "edit", copy, base);
          else dropUnsaved(setId, "edit", sentAt);
        },
        () => keepUnsaved(setId, "edit", copy, base),
      );
    };
  }, [setId]);

  // A copy the last load of this editor could not save comes back onto the
  // copy it was made from (unsaved.ts), as an edit: in the history, on the
  // stage, and saved.
  useEffect(() => {
    const id = setTimeout(() => {
      const kept = takeUnsaved(setId, "edit", savedKeyRef.current);
      if (kept === null) return;
      const n = normaliseSetSpec(kept);
      if (n.ok) commitRef.current({ ok: true, spec: n.spec, notes: [] });
    }, 0);
    return () => clearTimeout(id);
  }, [setId]);

  // ---- what the panels say ----
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const shapeName = (shape: SetShape) => s.editorShapes[shape];
  const lightKindName = (kind: SetLightKind) => s.editorLights[kind];
  const findings = useMemo(() => checkSet(spec), [spec]);
  const findingTarget = (f: SetFinding): EditTarget =>
    f.kind === "through" ? { kind: "object", index: f.big } : f.kind === "camera-inside" ? { kind: "camera", index: f.camera } : f.kind === "mark-inside" ? { kind: "mark", index: f.mark } : { kind: "object", index: f.object };
  const findingLine = (f: SetFinding): string => {
    const name = (i: number) => (spec.objects[i] ? objectName(spec.objects[i]) : `#${i + 1}`);
    switch (f.kind) {
      case "through":
        return formatMsg(s.editorFindingThrough, { big: name(f.big), small: name(f.small) });
      case "camera-inside":
        return formatMsg(s.editorFindingCamera, { camera: cameraName(f.camera), object: name(f.object) });
      case "mark-inside":
        return formatMsg(s.editorFindingMark, { mark: markName(f.mark), object: name(f.object) });
      case "sunk":
        return formatMsg(s.editorFindingSunk, { object: name(f.object), d: f.depthM });
    }
  };
  const lightName = (li: number) => {
    const kind = spec.lights[li].kind;
    const before = spec.lights.slice(0, li).filter((l) => l.kind === kind).length;
    const total = spec.lights.filter((l) => l.kind === kind).length;
    return total > 1 ? `${lightKindName(kind)} ${before + 1}` : lightKindName(kind);
  };
  const objectName = (o: SetObject) => `${shapeName(o.shape)} · ${r1(o.size[0])}×${r1(o.size[1])}×${r1(o.size[2])}`;
  const markName = (mi: number) => spec.marks[mi].label || formatMsg(s.editorMarkN, { n: mi + 1 });
  const cameraName = (ci: number) => spec.cameras[ci].label || formatMsg(s.editorCameraN, { n: ci + 1 });
  // A selection that no longer names anything reads as the set itself: a
  // list can shorten under it (an Astra change, a step back).
  const selGone = Boolean(sel && "index" in sel && !(sel.kind === "object" ? spec.objects : sel.kind === "light" ? spec.lights : sel.kind === "mark" ? spec.marks : spec.cameras)[sel.index]);
  const selName = !sel || selGone
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
  const saveLine =
    saveState === "saving" ? s.editorSaving : saveState === "failed" ? s.editorSaveFailed : saveState === "saved" ? s.editorSaved : "";
  const toolName =
    tool === "select"
      ? s.editorToolSelect
      : tool === "move"
        ? s.editorToolMove
        : tool === "rotate"
          ? s.editorToolRotate
          : tool === "measure"
            ? s.studio.tools.measure
            : s.editorToolScale;

  // `?? null` because a list can shorten under the selection (an Astra
  // change, a step back): the types say a thing is there, the arrays do not.
  const selObject = sel?.kind === "object" ? (spec.objects[sel.index] ?? null) : null;
  const selLight = sel?.kind === "light" ? (spec.lights[sel.index] ?? null) : null;
  const selMark = sel?.kind === "mark" ? (spec.marks[sel.index] ?? null) : null;
  const selCamera = sel?.kind === "camera" ? (spec.cameras[sel.index] ?? null) : null;
  const selRepeat = selObject?.repeat ?? null;
  const fogNow = spec.fog;
  const C = SET_LIMITS.maxCoordinate;

  // Astra's prompt bar, at the dock's foot whatever the tab (the studio's frame, cut A).
  const promptBar = (
            <div className="p-3">
              {(askNote !== null || askError || asking || astraTooBig) && (
                <div className="mx-auto mb-2 flex w-fit max-w-full items-center gap-2 rounded-[8px] border border-[rgba(255,255,255,0.11)] bg-[rgba(25,26,32,0.94)] px-3 py-1.5 text-[12px] text-[#d6d9e0] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
                  {asking ? (
                    <span>{s.editorAsking}</span>
                  ) : askError ? (
                    <span className="text-red-400">{localizeServerText(askError, t)}</span>
                  ) : askNote === null ? (
                    <span className="text-[#c6c9d1]">{localizeServerText(SET_EDIT_TOO_BIG, t)}</span>
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
              <div className="flex h-11 items-center gap-2.5 rounded-[10px] border border-[rgba(255,255,255,0.11)] bg-[rgba(25,26,32,0.94)] pl-3 pr-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]">
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
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#ecedf1] outline-none placeholder:text-[#9aa0ad] disabled:text-[#9aa0ad]"
                />
                {editsLeft !== null && (
                  <span title={s.editorAskLeftTitle} className="flex-none whitespace-nowrap text-[11px] tabular-nums text-[#9aa0ad]">
                    {editsLeft === 0 ? s.editorAskLeftNone : editsLeft === 1 ? s.editorAskLeftOne : formatMsg(s.editorAskLeft, { n: editsLeft })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void sendAsk()}
                  disabled={asking || ask.trim().length === 0 || astraTooBig}
                  className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[7px] bg-[#e0a468] text-[#1b1c20] disabled:cursor-default disabled:bg-[rgba(255,255,255,0.06)] disabled:text-[#c6c9d1]"
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
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#141519] font-sans text-[13px] leading-[18px] text-[#d6d9e0]" data-set-editor>
      {/* A phone held upright has no room for a rail, a canvas and a 300 px
          panel: it is told so, with the way back, rather than handed an
          editor it cannot see. Turned sideways, most phones clear it. */}
      <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-[#141519] px-8 text-center sm:hidden">
        <p className="max-w-xs text-[14px] leading-[21px] text-[#d6d9e0]">{s.editorNarrow}</p>
        <button
          type="button"
          onClick={() => void done()}
          className="flex h-9 cursor-pointer items-center rounded-[8px] bg-[#e0a468] px-4 text-[13px] font-semibold text-[#1b1c20]"
        >
          {s.editorDone}
        </button>
      </div>
      {/* The studio's frame (canvas page J, board J1; cut A): the bar across the top, the same in every mode. */}
      <StudioBar
        back={{ href: "/app/sets", label: s.back }}
        title={spec.title || s.untitled}
        mode="build"
        modes={{
          build: { label: s.editorBuildTab },
          shoot: { label: s.editorShootTab, onClick: () => void done() },
          film: { label: s.filmTab, onClick: () => void done(`${closeHref}?film=1`) },
          cut: { label: s.studio.cutMode, onClick: () => void done(`${closeHref}?cut=1`) },
        }}
        view={{ mode: view, onChange: setView, label: s.studio.viewLabel, names: { lit: s.editorViewLit, clay: s.editorViewClay, wire: s.editorViewWire, depth: s.editorViewDepth } }}
        find={{ label: s.studio.find, kbd: s.palette.open, onOpen: openFind }}
        primary={
          <button
            type="button"
            onClick={() => void done()}
            className="flex h-7 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] bg-[#e0a468] px-3.5 text-[12px] font-semibold text-[#1b1c20]"
          >
            {s.editorDone}
          </button>
        }
      >
        <button type="button" onClick={undo} disabled={at === 0} className={ICON_BTN} title={s.editorUndo} aria-label={s.editorUndo}>
          <Svg d={D.undo} className="h-[15px] w-[15px]" />
        </button>
        <button type="button" onClick={redo} disabled={at >= history.length - 1} className={ICON_BTN} title={s.editorRedo} aria-label={s.editorRedo}>
          <Svg d={D.redo} className="h-[15px] w-[15px]" />
        </button>
        <span className="text-[12px] tabular-nums text-[#c6c9d1]">{rowLabel(at)}</span>
        <span aria-hidden className="h-5 w-px bg-[rgba(255,255,255,0.09)]" />
        <span className="text-[12px] text-[#9aa0ad]">{saveLine}</span>
        <button
          type="button"
          onClick={() => void restoreOriginal()}
          className="cursor-pointer text-[12px] text-[#d6d9e0] hover:text-[#ecedf1]"
          title={s.editorOriginalHint}
        >
          {s.editorOriginal}
        </button>
        <button type="button" onClick={exportJson} className={ICON_BTN} title={s.editorExport} aria-label={s.editorExport}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
        </button>
      </StudioBar>

      <div className="flex min-h-0 flex-1 items-stretch">
        {/* The rail (studio-frame.tsx): the nine drawn tools on single keys, then Add for the shapes and the lights. */}
        <StudioRail mode="build" tool={RAIL_OF_TOOL[tool]} onTool={(id) => railRef.current(id)} names={s.studio.tools} notes={s.studio.toolNotes}>
          <span aria-hidden className="my-1 h-px w-6 bg-[rgba(255,255,255,0.08)]" />
          <button type="button" onClick={() => setAddOpen((v) => !v)} className={addOpen ? TOOL_ON : TOOL_BTN} title={s.editorAdd} aria-label={s.editorAdd}>
            <Svg d={D.add} />
          </button>
          {/* A click anywhere off a menu closes it, as the page's other menus do. */}
          {(addOpen || kitOpen) && (
            <div
              aria-hidden
              className="fixed inset-0 z-10"
              onClick={() => {
                setAddOpen(false);
                setKitOpen(false);
              }}
            />
          )}
          {addOpen && (
            <div className={`absolute left-12 top-[352px] z-20 flex min-w-[12rem] flex-col gap-0.5 rounded-[10px] border ${HAIR} ${PANEL} p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]`}>
              {SET_SHAPES.map((shape) => (
                <button key={shape} type="button" onClick={() => addThing(shape)} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)]">
                  <Svg d={D.cube} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                  {shapeName(shape)}
                </button>
              ))}
              <span aria-hidden className="mx-2 my-1 h-px bg-[rgba(255,255,255,0.08)]" />
              <button type="button" onClick={addALight} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)]">
                <Svg d={D.bulb} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                {s.editorAddLight}
              </button>
              <button type="button" onClick={addAnAreaLight} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)]">
                <Svg d={D.bulb} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                {s.editorAddArea}
              </button>
            </div>
          )}
          {kitOpen && (
            <div className={`absolute left-12 top-[296px] z-20 flex min-w-[12rem] flex-col gap-0.5 rounded-[10px] border ${HAIR} ${PANEL} p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]`}>
              <div className={SHEAD}>{s.editorAddKit}</div>
              {KIT_KINDS.map((kind) => (
                <button key={kind} type="button" onClick={() => {
                    setKitOpen(false);
                    addAProp(kind);
                  }} className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)]">
                  <Svg d={D.add} className="h-[13px] w-[13px] text-[#8b8f9a]" />
                  {s.editorKits[kind]}
                </button>
              ))}
            </div>
          )}
        </StudioRail>

        {/* canvas column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* context bar */}
          <div className={`${BAR} flex h-9 flex-none items-center gap-2 border-b ${HAIR} px-3`}>
            <span className="text-[12px] font-semibold text-[#ecedf1]">{toolName}</span>
            <span className="min-w-0 truncate text-[11px] text-[#9aa0ad]">{selName}</span>
            {selObject && sel?.kind === "object" && (
              <>
                <span aria-hidden className="mx-1 h-[18px] w-px bg-[rgba(255,255,255,0.09)]" />
                <span className="w-72 flex-none">
                  <Vec3Row value={selObject.position} min={-C} max={C} onCommit={(v) => commit(patchObject(spec, sel.index, { position: v }))} />
                </span>
                <button
                  type="button"
                  onClick={() => commit(patchObject(spec, sel.index, { position: [selObject.position[0], selObject.size[1] / 2, selObject.position[2]] }))}
                  className="cursor-pointer whitespace-nowrap text-[11px] text-[#d6d9e0] hover:text-[#ecedf1]"
                >
                  {s.editorRestGround}
                </button>
              </>
            )}
            <span aria-hidden className="mx-1 h-[18px] w-px bg-[rgba(255,255,255,0.09)]" />
            <Check on={snap} onToggle={() => setSnap((v) => !v)}>
              {s.editorSnap}
            </Check>
            <span className="flex-1" />
            {flash && <span className="min-w-0 truncate text-[11px] text-[#e0a468]">{flash}</span>}
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[#9aa0ad]">
              {formatMsg(s.editorCounts, { things: spec.objects.length, shapes: specInstanceCount(spec), max: SET_LIMITS.maxInstances })}
            </span>
          </div>

          {/* the stage */}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#101116]">
            <div ref={hostRef} className="absolute inset-0" />
            {/* The measure's line (cut C, furniture.ts), over the stage. */}
            <svg ref={measureRef} style={{ display: "none" }} aria-hidden data-measure className="pointer-events-none absolute inset-0 z-10 h-full w-full">
              <line stroke="#f0cda6" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle data-end="a" r="4" fill="#f0cda6" />
              <circle data-end="b" r="4" fill="#f0cda6" />
              <text fill="#ffffff" fontSize="11" fontWeight="600" textAnchor="middle" paintOrder="stroke" stroke="rgba(0,0,0,0.7)" strokeWidth="3" />
            </svg>
            {tool === "measure" && (
              <span className="pointer-events-none absolute left-3 top-3 rounded-[6px] border border-[rgba(255,255,255,0.09)] bg-[rgba(20,21,25,0.85)] px-2.5 py-1 text-[11px] text-[#c6c9d1]">
                {s.studio.measureHint}
              </span>
            )}
            {!ready && !loadFailed && (
              <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] text-[#9aa0ad]">{s.editorLoading}</p>
            )}
            {loadFailed && (
              <p className="absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 text-center text-[12px] text-[#c6c9d1]">
                {s.editorLoadFailed}
              </p>
            )}
            <span className="pointer-events-none absolute bottom-4 left-3 rounded-[6px] border border-[rgba(255,255,255,0.09)] bg-[rgba(20,21,25,0.85)] px-2.5 py-1 text-[11px] text-[#c6c9d1]">
              {s.editorOrbitHint}
            </span>

          </div>
        </div>

        {/* The dock (studio-frame.tsx): the scene and its properties, the edits, Astra — with Astra's prompt at its foot whatever the tab. */}
        <StudioDock label={s.studio.dockLabel} tabs={dockTabsFor("build", false)} names={s.studio.dock} tab={dockTab} onTab={setDockTab} foot={promptBar}>
          {dockTab === "scene" && (
            <div className="flex h-full min-h-0 flex-col">
              <div className={`flex flex-none items-center gap-2 border-b ${HAIR} px-3 py-2`}>
                <input
                  ref={findRef}
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder={s.editorFind}
                  aria-label={s.editorFind}
                  className="h-6 min-w-0 flex-1 rounded-[5px] bg-[#111217] px-2 text-[11px] text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] outline-none placeholder:text-[#9aa0ad] focus:shadow-[inset_0_0_0_1px_rgba(224,164,104,0.6)]"
                />
                <span className="text-[11px] tabular-nums text-[#9aa0ad]">{spec.objects.length}</span>
              </div>
              <div className="min-h-0 max-h-[44%] flex-[0_0_auto] overflow-y-auto">
                <SceneTree spec={spec} s={s} selected={sel} onPick={setSel} onRoot={() => setSel(null)} query={find} />
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
                  <ColorField hexLabel={s.editorHex} value={selObject.color} onCommit={(v) => commit(patchObject(spec, sel.index, { color: v }))} />
                </PRow>
                <PRow label={s.editorRoughness}>
                  <Slider value={selObject.roughness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchObject(spec, sel.index, { roughness: v }))} />
                </PRow>
                <PRow label={s.editorMetallic}>
                  <Slider value={selObject.metalness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchObject(spec, sel.index, { metalness: v }))} />
                </PRow>
                <PRow label={s.editorMaterial}>
                  <MaterialPick
                    value={selObject.material}
                    inferred={materialOf(selObject)}
                    onCommit={(m) => commit(patchObject(spec, sel.index, { material: m }))}
                    s={s}
                  />
                </PRow>
                <PRow label={s.editorGlow}>
                  {selObject.emissive ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <ColorField hexLabel={s.editorHex} value={selObject.emissive} onCommit={(v) => commit(patchObject(spec, sel.index, { emissive: v }))} />
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
                        className="cursor-pointer text-[11px] text-[#d6d9e0] hover:text-[#ecedf1]"
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
                {selObject.shape === "torus" && <p className="px-3 pt-1 text-[11px] text-[#9aa0ad]">{s.editorTorusSize}</p>}
              </>
            )}

            {selLight && sel?.kind === "light" && (
              <>
                <div className={SHEAD}>{s.editorKind}</div>
                <PRow label={s.editorKind}>
                  <span className="text-[12px] text-[#ecedf1]">{lightKindName(selLight.kind)}</span>
                </PRow>
                <PRow label={s.editorColor}>
                  <ColorField hexLabel={s.editorHex} value={selLight.color} onCommit={(v) => commit(patchLight(spec, sel.index, { color: v }))} />
                </PRow>
                {/* Kelvin writes the colour (light-kelvin.ts): a way of choosing one, not new data. */}
                <PRow label={s.editorKelvin}>
                  <Slider
                    value={nearestKelvin(selLight.color)}
                    min={KELVIN_MIN}
                    max={KELVIN_MAX}
                    step={KELVIN_STEP}
                    onCommit={(v) => commit(patchLight(spec, sel.index, { color: kelvinToHex(v) }))}
                  />
                </PRow>
                <PRow label={s.editorIntensity}>
                  <Slider
                    value={selLight.intensity}
                    min={0}
                    max={selLight.kind === "ambient" || selLight.kind === "hemisphere" ? 5 : selLight.kind === "sun" ? 10 : selLight.kind === "area" ? 200 : 500}
                    step={0.1}
                    onCommit={(v) => commit(patchLight(spec, sel.index, { intensity: v }))}
                  />
                </PRow>
                {selLight.kind !== "ambient" && selLight.kind !== "hemisphere" && (
                  <PRow label={s.editorPosition}>
                    <Vec3Row value={selLight.position} min={-C} max={C} onCommit={(v) => commit(patchLight(spec, sel.index, { position: v }))} />
                  </PRow>
                )}
                {(selLight.kind === "sun" || selLight.kind === "spot" || selLight.kind === "area") && (
                  <PRow label={s.editorPointsAt}>
                    <Vec3Row value={selLight.target} min={-C} max={C} onCommit={(v) => commit(patchLight(spec, sel.index, { target: v }))} />
                  </PRow>
                )}
                {selLight.kind === "area" && selLight.size && (
                  <PRow label={s.editorAreaSize}>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Num ax="W" value={selLight.size[0]} min={0.1} max={30} unit="m" onCommit={(v) => commit(patchLight(spec, sel.index, { size: [v, selLight.size?.[1] ?? 1] }))} />
                      <Num ax="H" value={selLight.size[1]} min={0.1} max={30} unit="m" onCommit={(v) => commit(patchLight(spec, sel.index, { size: [selLight.size?.[0] ?? 1, v] }))} />
                    </span>
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
                    <ColorField hexLabel={s.editorHex} value={selLight.groundColor ?? spec.ground.color} onCommit={(v) => commit(patchLight(spec, sel.index, { groundColor: v }))} />
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
                  <Slider value={selCamera.fovDeg} min={SET_LIMITS.minFovDeg} max={SET_LIMITS.maxFovDeg} step={1} onCommit={(v) => commit(patchCamera(spec, sel.index, { fovDeg: v }))} />
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
                              : "bg-[rgba(255,255,255,0.05)] text-[#c6c9d1]"
                          }`}
                        >
                          {s.editorSkyKinds[kind]}
                        </button>
                      ))}
                    </div>
                    {spec.sky.colors.map((c, i) => (
                      <PRow key={`sky${i}`} label={i === 0 ? s.editorColor : ""}>
                        <ColorField
                          hexLabel={s.editorHex}
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
                      <ColorField hexLabel={s.editorHex} value={spec.ground.color} onCommit={(v) => commit(patchGround(spec, { color: v }))} />
                    </PRow>
                    <PRow label={s.editorRoughness}>
                      <Slider value={spec.ground.roughness} min={0} max={1} step={0.05} onCommit={(v) => commit(patchGround(spec, { roughness: v }))} />
                    </PRow>
                    <PRow label={s.editorMaterial}>
                      <MaterialPick
                        value={spec.ground.material}
                        inferred={groundMaterialOf(spec.ground)}
                        onCommit={(m) => commit(patchGround(spec, { material: m }))}
                        s={s}
                      />
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
                          <ColorField hexLabel={s.editorHex} value={fogNow.color} onCommit={(v) => commit(patchFog(spec, { ...fogNow, color: v }))} />
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
                    <p className="px-3 py-1 text-[12px] tabular-nums text-[#d6d9e0]">
                      {formatMsg(s.editorBoundsTall, { x: r1(spec.bounds.x), z: r1(spec.bounds.z), h: r1(spec.bounds.height) })}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
            </div>
          )}
          {dockTab === "history" && (
            <div className="p-2">
              <div className="flex h-6 items-center px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]">{s.studio.historyEdits}</div>
              <div role="listbox" aria-label={s.studio.historyEdits} className="flex flex-col gap-0.5">
                {history.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="option"
                    aria-selected={i === at}
                    onClick={() => goTo(i)}
                    className={`flex h-8 w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 text-left text-[12px] ${
                      i === at ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#ecedf1]"
                    }`}
                  >
                    <span>{rowLabel(i)}</span>
                    {i === at && <span aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dockTab === "astra" && (
            <div className="flex flex-col gap-3 p-3 text-[12px] leading-relaxed text-[#c6c9d1]">
              <p>{s.studio.threadHint}</p>
              <p>{s.editorRules}</p>
            </div>
          )}
        </StudioDock>
      </div>

      {/* status bar (studio-frame.tsx) */}
      <StudioStatus>
        <span className="tabular-nums">{formatMsg(s.editorBoundsTall, { x: r1(spec.bounds.x), z: r1(spec.bounds.z), h: r1(spec.bounds.height) })}</span>
        <span className="hidden sm:inline">{s.editorYourCopy}</span>
        {/* The set check (set-check.ts): what stands through what, read off the working copy after every edit. */}
        <button
          type="button"
          onClick={() => setCheckOpen((v) => !v)}
          aria-expanded={checkOpen}
          className={`flex h-5 cursor-pointer items-center gap-1.5 rounded-full px-2 ${findings.length ? "bg-[rgba(224,164,104,0.13)] text-[#e0a468]" : "text-[#d6d9e0] hover:text-[#ecedf1]"}`}
        >
          <span aria-hidden className={`h-[5px] w-[5px] rounded-full ${findings.length ? "bg-[#e0a468]" : "bg-[#5f9e6e]"}`} />
          {s.editorCheck} · {findings.length ? formatMsg(s.editorCheckN, { n: findings.length }) : s.editorCheckClean}
        </button>
        {checkOpen && findings.length > 0 && (
          <div className={`absolute bottom-7 left-3.5 z-30 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-0.5 rounded-[10px] border ${HAIR} ${PANEL} p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]`}>
            {findings.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSel(findingTarget(f));
                  setCheckOpen(false);
                }}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)]"
              >
                <span className="min-w-0 flex-1 truncate">{findingLine(f)}</span>
                <span className="text-[11px] text-[#e0a468]">{s.editorFindingSelect}</span>
              </button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        <span className="hidden md:inline">{s.editorRules}</span>
      </StudioStatus>
    </div>
  );
}
