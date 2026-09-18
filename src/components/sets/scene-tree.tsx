"use client";

// The scene tree (the studio's dock, Scene tab; cut A, 2026-09-17): the
// set's environment, lights, things, marks and cameras as rows, shared by
// Build (where a row selects what the inspector edits) and the shoot
// (where a camera or a mark takes the figure there and a thing turns the
// view to it). The names are the editor's, so a thing is called the same
// in both.

import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import type { EditTarget } from "@/lib/sets/editor-model";
import type { SetLightKind, SetObject, SetShape, SetSpec } from "@/lib/sets/set-spec";
import { StudioSvg } from "./studio-frame";

type Strings = Messages["sets"];
export type SceneTarget = EditTarget;

const ICONS = {
  sun: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  bulb: "M9 18h6M10 21h4|M12 3a6 6 0 0 1 3.6 10.8c-.6.5-.6 1.2-.6 1.2h-6s0-.7-.6-1.2A6 6 0 0 1 12 3z",
  person: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z|M6 20a6 6 0 0 1 12 0",
  camera: "m22 8-6 3 6 3z|M2 6h14v12H2z",
  sky: "M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.6A4 4 0 0 0 6 18z",
};

export const TREE_HEAD = "flex h-6 items-center px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** How the tree names what it lists, from the set's words. */
export function sceneNames(spec: SetSpec, s: Strings) {
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
  return { shapeName, lightKindName, lightName, objectName, markName, cameraName };
}

export function sameTarget(a: SceneTarget | null, b: SceneTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  return "index" in a && "index" in b ? a.index === b.index : true;
}

export function TreeRow({
  icon,
  dot,
  name,
  badge,
  child,
  selected,
  onPick,
}: {
  icon?: keyof typeof ICONS;
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
        selected ? "bg-[rgba(224,164,104,0.12)] text-[#e0a468] shadow-[inset_2px_0_0_#e0a468]" : "text-[#d6d9e0] hover:bg-white/[0.04]"
      }`}
    >
      {dot ? (
        <span className="h-2.5 w-2.5 flex-none rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ background: dot }} />
      ) : icon ? (
        <StudioSvg d={ICONS[icon]} className={`h-[13px] w-[13px] flex-none ${selected ? "" : "text-[#8b8f9a]"}`} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {badge && <span className="flex-none text-[11px] tabular-nums text-[#9aa0ad]">{badge}</span>}
    </button>
  );
}

/**
 * The tree. `query` filters every row by name; the environment's own row
 * shows only without a query, as the editor's did. `onRoot` is the
 * environment row's pick (Build selects the set itself); without it the
 * row is not drawn.
 */
export function SceneTree({
  spec,
  s,
  selected,
  onPick,
  onRoot,
  query,
}: {
  spec: SetSpec;
  s: Strings;
  selected: SceneTarget | null;
  onPick: (target: SceneTarget) => void;
  onRoot?: () => void;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const hit = (name: string) => !q || name.toLowerCase().includes(q);
  const names = sceneNames(spec, s);
  return (
    <div className="py-1">
      {!q && onRoot && <TreeRow icon="sun" name={s.editorEnvironment} selected={false} onPick={onRoot} />}
      {/* The row's whole name, its kind included: "gradient" found the sky (2026-09-17). */}
      {hit(`${s.editorSky} — ${s.editorSkyKinds[spec.sky.kind]}`) && (
        <TreeRow icon="sky" child name={`${s.editorSky} — ${s.editorSkyKinds[spec.sky.kind]}`} selected={selected?.kind === "sky"} onPick={() => onPick({ kind: "sky" })} />
      )}
      {hit(s.editorGround) && <TreeRow dot={spec.ground.color} child name={s.editorGround} selected={selected?.kind === "ground"} onPick={() => onPick({ kind: "ground" })} />}
      {hit(`${s.editorFog}${spec.fog ? "" : ` — ${s.editorNone}`}`) && (
        <TreeRow icon="sky" child name={`${s.editorFog}${spec.fog ? "" : ` — ${s.editorNone}`}`} selected={selected?.kind === "fog"} onPick={() => onPick({ kind: "fog" })} />
      )}
      {spec.lights.map(
        (l, li) =>
          hit(names.lightName(li)) && (
            <TreeRow
              key={`l${li}`}
              icon={l.kind === "sun" ? "sun" : "bulb"}
              child
              name={names.lightName(li)}
              badge={String(r1(l.intensity))}
              selected={sameTarget(selected, { kind: "light", index: li })}
              onPick={() => onPick({ kind: "light", index: li })}
            />
          ),
      )}
      <div className={TREE_HEAD}>{s.editorThings}</div>
      {spec.objects.map(
        (o, oi) =>
          hit(names.objectName(o)) && (
            <TreeRow
              key={`o${oi}`}
              dot={o.color}
              child
              name={names.objectName(o)}
              badge={o.repeat ? `×${o.repeat.count}` : undefined}
              selected={sameTarget(selected, { kind: "object", index: oi })}
              onPick={() => onPick({ kind: "object", index: oi })}
            />
          ),
      )}
      <div className={TREE_HEAD}>{s.editorMarks}</div>
      {spec.marks.map(
        (m, mi) =>
          hit(names.markName(mi)) && (
            <TreeRow key={`m${mi}`} icon="person" child name={names.markName(mi)} selected={sameTarget(selected, { kind: "mark", index: mi })} onPick={() => onPick({ kind: "mark", index: mi })} />
          ),
      )}
      <div className={TREE_HEAD}>{s.editorCameras}</div>
      {spec.cameras.map(
        (c, ci) =>
          hit(names.cameraName(ci)) && (
            <TreeRow
              key={`c${ci}`}
              icon="camera"
              child
              name={names.cameraName(ci)}
              badge={`${Math.round(c.fovDeg)}°`}
              selected={sameTarget(selected, { kind: "camera", index: ci })}
              onPick={() => onPick({ kind: "camera", index: ci })}
            />
          ),
      )}
    </div>
  );
}
