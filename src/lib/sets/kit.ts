// The kit (cut 5 of "out of this world", 2026-09-17): props built from the
// stage's own seven primitives with their material words — a car, a tree, a
// lamp post, a bench, stairs, a rail — placed by hand in Build. Each is a
// handful of ordinary objects once placed (the editor's tree shows them
// one by one, and Astra can move them like anything else), so the set
// stays the same data it always was. Sizes are real: a compact car is
// 4.4 m long, a lamp post 4.5 m, a bench seat 0.45 m up. Pure.

import type { SetMaterial, SetObject, SetShape, Vec3 } from "./set-spec";

export const KIT_KINDS = ["car", "tree", "lamp", "bench", "stairs", "rail"] as const;
export type KitKind = (typeof KIT_KINDS)[number];

const DEG = Math.PI / 180;

type Part = {
  shape: SetShape;
  /** Offset from the prop's own origin, metres, before it is turned to face `facingDeg`: x right, y up, z forward. */
  at: Vec3;
  size: Vec3;
  color: string;
  material: SetMaterial;
  roughness?: number;
  metalness?: number;
  /** Degrees, the prop's own turn added to y. */
  rotation?: Vec3;
  emissive?: string;
  castShadow?: boolean;
};

const PARTS: Record<KitKind, (color: string) => Part[]> = {
  car: (paint) => [
    { shape: "box", at: [0, 0.55, 0], size: [1.8, 0.5, 4.4], color: paint, material: "paint", roughness: 0.2, metalness: 0.55 },
    { shape: "box", at: [0, 1.05, -0.2], size: [1.5, 0.5, 2.1], color: "#1b2933", material: "glass", roughness: 0.1, metalness: 0.4 },
    { shape: "box", at: [0, 1.32, -0.2], size: [1.45, 0.06, 1.9], color: paint, material: "paint", roughness: 0.2, metalness: 0.55 },
    { shape: "box", at: [0, 0.35, 0], size: [1.7, 0.16, 4.2], color: "#171b20", material: "rubber", roughness: 0.6 },
    ...([[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]] as const).map(
      ([x, z]): Part => ({ shape: "cylinder", at: [x, 0.33, z], size: [0.66, 0.24, 0.66], color: "#141518", material: "rubber", roughness: 0.92, rotation: [0, 0, 90] }),
    ),
    ...([[-0.98, 1.4], [0.98, 1.4], [-0.98, -1.4], [0.98, -1.4]] as const).map(
      ([x, z]): Part => ({ shape: "cylinder", at: [x, 0.33, z], size: [0.4, 0.02, 0.4], color: "#9aa0a8", material: "chrome", roughness: 0.25, metalness: 0.9, rotation: [0, 0, 90], castShadow: false }),
    ),
    { shape: "box", at: [-0.6, 0.62, 2.2], size: [0.34, 0.1, 0.06], color: "#e9f4ff", material: "matte", emissive: "#e8f5ff", castShadow: false },
    { shape: "box", at: [0.6, 0.62, 2.2], size: [0.34, 0.1, 0.06], color: "#e9f4ff", material: "matte", emissive: "#e8f5ff", castShadow: false },
    { shape: "box", at: [0, 0.62, -2.2], size: [1.4, 0.07, 0.05], color: "#b90e25", material: "matte", emissive: "#ff293b", castShadow: false },
  ],
  tree: (leaf) => [
    { shape: "cylinder", at: [0, 1.6, 0], size: [0.36, 3.2, 0.36], color: "#5a4632", material: "timber", roughness: 0.95 },
    { shape: "sphere", at: [0, 4.1, 0], size: [3.6, 3.2, 3.6], color: leaf, material: "foliage", roughness: 1 },
    { shape: "sphere", at: [0.9, 3.4, 0.5], size: [2.4, 2.2, 2.4], color: leaf, material: "foliage", roughness: 1 },
    { shape: "sphere", at: [-0.8, 3.6, -0.6], size: [2.2, 2, 2.2], color: leaf, material: "foliage", roughness: 1 },
  ],
  lamp: () => [
    { shape: "cylinder", at: [0, 0.15, 0], size: [0.5, 0.3, 0.5], color: "#2a2f34", material: "metal", roughness: 0.4, metalness: 0.7 },
    { shape: "cylinder", at: [0, 2.4, 0], size: [0.14, 4.5, 0.14], color: "#2a2f34", material: "metal", roughness: 0.4, metalness: 0.7 },
    { shape: "box", at: [0, 4.55, 0.55], size: [0.1, 0.08, 1.2], color: "#2a2f34", material: "metal", roughness: 0.4, metalness: 0.7 },
    { shape: "box", at: [0, 4.4, 1.05], size: [0.5, 0.18, 0.7], color: "#2a2f34", material: "metal", roughness: 0.4, metalness: 0.7 },
    { shape: "box", at: [0, 4.28, 1.05], size: [0.4, 0.06, 0.6], color: "#ffe6bd", material: "glass", emissive: "#ffd9a0", castShadow: false },
  ],
  bench: () => [
    { shape: "box", at: [0, 0.45, 0], size: [1.8, 0.06, 0.45], color: "#8a6a48", material: "timber", roughness: 0.85 },
    { shape: "box", at: [0, 0.75, -0.22], size: [1.8, 0.5, 0.05], color: "#8a6a48", material: "timber", roughness: 0.85, rotation: [-8, 0, 0] },
    { shape: "box", at: [-0.8, 0.22, 0], size: [0.06, 0.44, 0.4], color: "#2f3338", material: "metal", roughness: 0.4, metalness: 0.7 },
    { shape: "box", at: [0.8, 0.22, 0], size: [0.06, 0.44, 0.4], color: "#2f3338", material: "metal", roughness: 0.4, metalness: 0.7 },
  ],
  stairs: () =>
    Array.from({ length: 5 }, (_, i): Part => ({
      shape: "box",
      at: [0, 0.09 + i * 0.18, -0.15 - i * 0.3],
      size: [2, 0.18, 0.3 + (4 - i) * 0.3],
      color: "#8d8b86",
      material: "concrete",
      roughness: 0.85,
    })),
  rail: () => [
    { shape: "cylinder", at: [-1, 0.5, 0], size: [0.05, 1, 0.05], color: "#8c9198", material: "metal", roughness: 0.35, metalness: 0.8 },
    { shape: "cylinder", at: [1, 0.5, 0], size: [0.05, 1, 0.05], color: "#8c9198", material: "metal", roughness: 0.35, metalness: 0.8 },
    { shape: "cylinder", at: [0, 1, 0], size: [0.06, 2.1, 0.06], color: "#8c9198", material: "metal", roughness: 0.35, metalness: 0.8, rotation: [0, 0, 90] },
  ],
};

/** The default colour a kind is placed in: a car's paint, a tree's leaf. */
export const KIT_COLORS: Record<KitKind, string> = { car: "#c91420", tree: "#4f7a3a", lamp: "#2a2f34", bench: "#8a6a48", stairs: "#8d8b86", rail: "#8c9198" };

/** The objects a prop is, placed at `at` on the ground, turned to face `facingDeg` (0 = +Z, 90 = +X, as a mark faces). */
export function kitObjects(kind: KitKind, at: [number, number], facingDeg = 0, color = KIT_COLORS[kind]): SetObject[] {
  const a = facingDeg * DEG;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return PARTS[kind](color).map((p) => ({
    shape: p.shape,
    position: [r3(at[0] + p.at[0] * cos + p.at[2] * sin), r3(p.at[1]), r3(at[1] - p.at[0] * sin + p.at[2] * cos)],
    rotation: [p.rotation?.[0] ?? 0, r3(((p.rotation?.[1] ?? 0) + facingDeg) % 360), p.rotation?.[2] ?? 0],
    size: [...p.size] as Vec3,
    color: p.color,
    roughness: p.roughness ?? 0.8,
    metalness: p.metalness ?? 0,
    emissive: p.emissive ?? null,
    emissiveIntensity: p.emissive ? 1.5 : 1,
    castShadow: p.castShadow ?? true,
    repeat: null,
    material: p.material,
  }));
}

/** How many objects a kind adds. */
export function kitSize(kind: KitKind): number {
  return PARTS[kind](KIT_COLORS[kind]).length;
}
