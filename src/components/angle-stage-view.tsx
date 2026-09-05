"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { quoteSend } from "@/lib/generations/quote";
import { getVideoModel } from "@/lib/generations/providers/video-models";
import {
  createAngleProxy,
  pollAngleProxy,
  renderAngleFrame,
  pollAngleFrame,
} from "@/lib/generations/angle-stage";
import { runGeneration } from "@/lib/generations/actions";

// The Angle Stage (2026-09-05, built from the proven prototype). The page
// is a wizard with one honest job: manufacture a start and an end frame,
// then hand them to the EXISTING frames lane. Nothing here touches money —
// the render's price comes from quoteSend (the same function the server
// charges with) and the submit goes through runGeneration like any other
// send.
//
// three.js loads dynamically inside the effect: it's ~600KB that only this
// route needs, and the server component must never try to render a WebGL
// canvas.

type Frame = { path: string; url: string };
type Handle = { requestId: string; statusUrl: string; responseUrl: string };

// The frames lane runs on Kling 1.6 — the same constraint the composer's
// Start & end frames option has. Fixed here, shown plainly in the UI.
const STAGE_VIDEO_MODEL = "kling";

export function AngleStageView({
  generationId,
  stillUrl,
  characterProfileId,
  initialProxyUrl,
  initialFrames,
  framesLimit,
  stagedThisMonth,
  monthlyLimit,
}: {
  generationId: string;
  stillUrl: string;
  characterProfileId: string | null;
  initialProxyUrl: string | null;
  initialFrames: Frame[];
  framesLimit: number;
  stagedThisMonth: number;
  monthlyLimit: number;
}) {
  const { t } = useLocale();
  const s = t.stage;
  const router = useRouter();

  const [proxyUrl, setProxyUrl] = useState(initialProxyUrl);
  const [building, setBuilding] = useState(false);
  const [frames, setFrames] = useState<Frame[]>(initialFrames);
  const [renderingAngle, setRenderingAngle] = useState(false);
  const [error, setError] = useState("");
  // Selection over [-1 = the original still, 0..n = re-rendered frames].
  const [startPick, setStartPick] = useState<number | null>(-1);
  const [endPick, setEndPick] = useState<number | null>(null);
  const [movePrompt, setMovePrompt] = useState(s.movePromptDefault);
  const klingDurations = getVideoModel(STAGE_VIDEO_MODEL).durations;
  const [durationSeconds, setDurationSeconds] = useState(
    klingDurations.find((d) => d.default)?.seconds ?? klingDurations[0].seconds,
  );
  const [submitting, setSubmitting] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<(() => string | null) | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- the 3D stage ----
  useEffect(() => {
    if (!proxyUrl || !canvasHostRef.current) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      if (disposed || !canvasHostRef.current) return;

      const host = canvasHostRef.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.touchAction = "none";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x17150f);
      const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 100);
      const HOME = new THREE.Vector3(0, 0.12, 2.1);
      camera.position.copy(HOME);

      scene.add(new THREE.HemisphereLight(0xfff2df, 0x3a352b, 1.4));
      const key = new THREE.DirectionalLight(0xffe1b8, 1.05);
      key.position.set(2.4, 3.2, 2.6);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xcfd6ff, 0.45);
      rim.position.set(-2.6, 1.4, -2.2);
      scene.add(rim);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.6;
      controls.maxDistance = 5;

      new GLTFLoader().load(
        proxyUrl,
        (gltf) => {
          if (disposed) return;
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const c = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const scale = 1.4 / Math.max(size.x, size.y, size.z);
          root.position.sub(c).multiplyScalar(scale);
          root.scale.setScalar(scale);
          scene.add(root);
        },
        undefined,
        () => setError(t.stage.proxyLoadFailed),
      );

      let raf = 0;
      const size = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        const canvas = renderer.domElement;
        if (canvas.width !== w || canvas.height !== h) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      };
      const loop = () => {
        raf = requestAnimationFrame(loop);
        size();
        controls.update();
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      snapshotRef.current = () => {
        // 1280-wide JPEG regardless of the on-screen size, so the guided
        // re-render always gets the same sketch weight.
        renderer.render(scene, camera);
        const src = renderer.domElement;
        const out = document.createElement("canvas");
        out.width = 1280;
        out.height = 720;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, 1280, 720);
        return out.toDataURL("image/jpeg", 0.9);
      };
      resetCameraRef.current = () => {
        camera.position.copy(HOME);
        controls.target.set(0, 0, 0);
      };

      cleanup = () => {
        cancelAnimationFrame(raf);
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        snapshotRef.current = null;
        resetCameraRef.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
    // t.stage.proxyLoadFailed is stable per locale; re-mounting the whole GL
    // context on a language switch would be worse than a stale error string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyUrl]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const pollUntilDone = useCallback(
    (tick: () => Promise<boolean>, intervalMs: number) => {
      const run = async () => {
        const done = await tick();
        if (!done) pollTimerRef.current = setTimeout(run, intervalMs);
      };
      pollTimerRef.current = setTimeout(run, intervalMs);
    },
    [],
  );

  async function buildProxy() {
    setError("");
    setBuilding(true);
    const started = await createAngleProxy(generationId);
    if (started.error !== null) {
      setError(started.error);
      setBuilding(false);
      return;
    }
    const handle: Handle = started.handle;
    pollUntilDone(async () => {
      const res = await pollAngleProxy(generationId, handle);
      if (res.error !== null) {
        setError(res.error);
        setBuilding(false);
        return true;
      }
      if (res.state === "done") {
        setProxyUrl(res.proxyUrl);
        setBuilding(false);
        return true;
      }
      return false;
    }, 6000);
  }

  async function saveAngle() {
    setError("");
    const snapshot = snapshotRef.current?.();
    if (!snapshot) return;
    setRenderingAngle(true);
    const started = await renderAngleFrame(generationId, snapshot);
    if (started.error !== null) {
      setError(started.error);
      setRenderingAngle(false);
      return;
    }
    const handle: Handle = started.handle;
    pollUntilDone(async () => {
      const res = await pollAngleFrame(generationId, handle);
      if (res.error !== null) {
        setError(res.error);
        setRenderingAngle(false);
        return true;
      }
      if (res.state === "done") {
        setFrames((prev) => {
          const next = [...prev, res.frame];
          // The freshest angle is usually the end the person just framed.
          setEndPick(next.length - 1);
          return next;
        });
        setRenderingAngle(false);
        return true;
      }
      return false;
    }, 4000);
  }

  const pickUrl = (i: number | null) => (i === null ? null : i === -1 ? stillUrl : (frames[i]?.url ?? null));
  const startUrl = pickUrl(startPick);
  const endUrl = pickUrl(endPick);
  const bothPicked = Boolean(startUrl && endUrl && startPick !== endPick);

  // THE price, from the same function the server charges with: a plain
  // Kling send at this duration with a frame riding — exactly what the
  // submit below is.
  const quote = quoteSend({
    contentType: "video",
    videoModelId: STAGE_VIDEO_MODEL,
    videoDurationSeconds: durationSeconds,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: true,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  });

  async function renderMove() {
    if (!bothPicked || submitting) return;
    setError("");
    setSubmitting(true);
    const fd = new FormData();
    fd.set("prompt", movePrompt.trim() || s.movePromptDefault);
    fd.set("content_type", "video");
    fd.set("video_model_id", STAGE_VIDEO_MODEL);
    fd.set("video_duration_seconds", String(durationSeconds));
    fd.set("storyboard_start_path", startUrl!);
    fd.set("storyboard_end_path", endUrl!);
    if (characterProfileId) fd.set("character_id", characterProfileId);
    const result = await runGeneration(fd);
    if (result.error !== null) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    router.push(`/app/history/${result.id}`);
  }

  const tile =
    "relative aspect-video overflow-hidden rounded-media border transition-colors cursor-pointer bg-atelier-stage";

  return (
    <div className="space-y-5">
      {/* The stage itself, or the build gate. */}
      <div className="relative overflow-hidden rounded-media border border-atelier-rule bg-atelier-stage">
        {proxyUrl ? (
          <>
            <div ref={canvasHostRef} className="h-[46vh] min-h-[300px] w-full" />
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80">
              {s.dragHint}
            </span>
            <div className="absolute bottom-3 right-3 flex gap-2">
              <button
                type="button"
                onClick={() => resetCameraRef.current?.()}
                className="cursor-pointer rounded-control border border-onmedia/20 bg-black/60 px-3.5 py-2 text-xs font-medium text-onmedia backdrop-blur-sm transition-colors hover:border-onmedia/40"
              >
                {s.resetCamera}
              </button>
              <button
                type="button"
                onClick={() => void saveAngle()}
                disabled={renderingAngle || frames.length >= framesLimit}
                className="cursor-pointer rounded-control bg-atelier-accent px-3.5 py-2 text-xs font-semibold text-atelier-stage transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {renderingAngle ? s.renderingAngle : s.saveAngle}
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-[46vh] min-h-[300px] w-full flex-col items-center justify-center gap-4 p-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stillUrl}
              alt=""
              className="max-h-[55%] rounded-media border border-onmedia/10 object-contain opacity-80"
            />
            <p className="max-w-md text-sm text-onmedia/70">{s.proxyHint}</p>
            <button
              type="button"
              onClick={() => void buildProxy()}
              disabled={building}
              className="cursor-pointer rounded-control bg-atelier-accent px-5 py-2.5 text-sm font-semibold text-atelier-stage transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {building ? s.buildingProxy : s.buildProxy}
            </button>
            {monthlyLimit >= 0 && (
              <p className="text-xs text-onmedia/50">
                {formatMsg(s.monthlyUsage, { used: stagedThisMonth, limit: monthlyLimit })}
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{localizeServerText(error, t)}</p>}

      {/* The angles: the original still plus every re-rendered frame. */}
      <div>
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
          {s.framesTitle}
        </h2>
        <p className="mt-1 text-xs text-atelier-muted">{s.framesHint}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[{ url: stillUrl, path: "original" }, ...frames].map((f, idx) => {
            const i = idx - 1; // -1 = the original still
            const isStart = startPick === i;
            const isEnd = endPick === i;
            return (
              <div
                key={f.path}
                className={`${tile} ${isStart || isEnd ? "border-atelier-accent" : "border-atelier-rule hover:border-atelier-muted/60"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                {i === -1 && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-widest text-onmedia">
                    {s.originalLabel}
                  </span>
                )}
                {isStart && (
                  <span className="absolute right-2 top-2 rounded-full bg-atelier-accent px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-widest text-atelier-stage">
                    {s.startTag}
                  </span>
                )}
                {isEnd && (
                  <span className="absolute right-2 top-2 rounded-full bg-atelier-ink px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-widest text-atelier-paper">
                    {s.endTag}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity hover:opacity-100 [@media(hover:none)]:opacity-100">
                  <button
                    type="button"
                    onClick={() => setStartPick(i)}
                    className="cursor-pointer rounded-full border border-onmedia/25 bg-black/50 px-2.5 py-1 text-[10px] font-medium text-onmedia hover:border-onmedia/50"
                  >
                    {s.setStart}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndPick(i)}
                    className="cursor-pointer rounded-full border border-onmedia/25 bg-black/50 px-2.5 py-1 text-[10px] font-medium text-onmedia hover:border-onmedia/50"
                  >
                    {s.setEnd}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The move: prompt, length, and the render through the normal lane. */}
      <div className="space-y-3 border-t border-atelier-rule pt-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
            {s.movePromptLabel}
          </span>
          <textarea
            value={movePrompt}
            onChange={(e) => setMovePrompt(e.target.value)}
            rows={2}
            className="mt-1.5 w-full rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors focus:border-atelier-accent"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
              {s.durationLabel}
            </span>
            {klingDurations.map((d) => (
              <button
                key={d.seconds}
                type="button"
                onClick={() => setDurationSeconds(d.seconds)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  durationSeconds === d.seconds
                    ? "border-atelier-accent bg-atelier-accent/10 text-atelier-ink"
                    : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
                }`}
              >
                {d.seconds}s
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {!bothPicked && <span className="text-xs text-atelier-muted">{s.needBothFrames}</span>}
            <button
              type="button"
              onClick={() => void renderMove()}
              disabled={!bothPicked || submitting}
              className="cursor-pointer rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? s.renderingMove : formatMsg(s.renderMove, { n: quote.totalCredits })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
