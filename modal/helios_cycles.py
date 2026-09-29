"""Helios Studio - Blender (Cycles) renders on one of Modal's GPUs.

Picacho's own render machine (2026-09-29, the operator picked "Real Blender
renders"). The website (src/lib/sets/cycles-actions.ts) sends a job here;
this app runs the official Blender for Linux in the background, renders the
Studio's scene with Cycles on the GPU, and uploads the PNG or MP4 to a
one-time upload address the website made for it. Nothing is kept here.

Two parts:
  * ``render`` - the GPU function (L40S). One call = one still or one
    animation. No retries (a retry would spend twice).
  * ``api`` - the web door, behind Modal's proxy auth (every request needs
    the Modal-Key and Modal-Secret headers of a Proxy Auth Token):
        POST /render             -> {"call_id": "..."}   (starts it, answers at once)
        GET  /result/{call_id}   -> {"state": "running" | "done" | "failed" | "timeout" | "expired", ...}

Why the official tarball and not the PyPI ``bpy`` wheel (read 2026-09-29):
the tarball is the same build Blender ships to everyone, run the documented
way (``blender -b``), with Cycles' CUDA and OptiX kernels included; it
carries its own Python, so this image's Python is free. The ``bpy`` 5.2.2
wheel is the same 383 MB of Blender tied to exactly Python 3.13 and is not
the documented route for command-line renders. The file is pinned by its
SHA-256 from download.blender.org, so a changed file fails the build.

Licence: Blender is free software under the GNU GPL (v2 or later; the
bundle as a whole is GPL-3). Running it unmodified as a server tool is
allowed and puts no terms on the renders - they are the person's own. We
don't change or hand out Blender, so there is nothing to publish; if we
ever ship a modified Blender, its source must go with it.

OptiX needs NVIDIA driver 575 or newer (Blender manual, GPU rendering);
when the machine's driver is older, or OptiX isn't there, the render uses
CUDA on the same GPU and says so in its result ("device").

Deploy: see modal/README.md.
"""

import json
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.request

import modal
from modal.exception import FunctionTimeoutError, OutputExpiredError

# --- the machine (MUST match src/lib/sets/cycles.ts) -------------------------
GPU = "L40S"
CPU_CORES = 4.0
MEMORY_MIB = 16 * 1024
# The hard stop for one render: 100 minutes. The most one render can cost is
# 6,000 s x $0.00062992 = $3.78 (prices in cycles.ts, read 2026-09-29).
TIMEOUT_S = 6000
# At most two renders at once, so a mistake can't fan out across many GPUs.
MAX_CONTAINERS = 2

BLENDER_VERSION = "5.2.2"
BLENDER_SERIES = "5.2"
BLENDER_SHA256 = "84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168"
BLENDER_URL = f"https://download.blender.org/release/Blender{BLENDER_SERIES}/blender-{BLENDER_VERSION}-linux-x64.tar.xz"
BLENDER = "/opt/blender/blender"

MAX_GLB_BYTES = 50 * 1024 * 1024
MAX_RESULT_BYTES = 500 * 1024 * 1024

render_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "curl",
        "xz-utils",
        "ffmpeg",
        # What the Linux Blender loads even in the background.
        "libx11-6",
        "libxi6",
        "libxxf86vm1",
        "libxfixes3",
        "libxrender1",
        "libxext6",
        "libxkbcommon0",
        "libsm6",
        "libice6",
        "libgl1",
        "libegl1",
    )
    .run_commands(
        f"curl -fsSL -o /tmp/blender.tar.xz {BLENDER_URL}",
        f"echo '{BLENDER_SHA256}  /tmp/blender.tar.xz' | sha256sum -c -",
        "mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/blender.tar.xz",
        # The build fails here, not on the first render, if Blender can't start.
        f"{BLENDER} --version",
    )
    # Asks the GPU runtime for every driver library (OptiX lives beside the
    # graphics ones). If the platform ignores it, the render uses CUDA.
    .env({"NVIDIA_DRIVER_CAPABILITIES": "all"})
)
web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")

app = modal.App("helios-cycles")
# Frame n of m for a running render, by call id (read by GET /result).
progress = modal.Dict.from_name("helios-cycles-progress", create_if_missing=True)


# --- the script Blender runs --------------------------------------------------
# Runs inside Blender's own Python: blender -b --factory-startup --python job.py -- job.json
BLENDER_SCRIPT = r'''
import bpy, json, math, sys
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# The GPU: OptiX first (RTX hardware ray tracing), CUDA second. Never the CPU:
# a CPU render on a GPU machine would be slow and still paid for.
prefs = bpy.context.preferences.addons["cycles"].preferences
device = None
for kind in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = kind
    except TypeError:
        continue
    getattr(prefs, "refresh_devices", prefs.get_devices)()
    gpus = [d for d in prefs.devices if d.type == kind]
    if gpus:
        for d in prefs.devices:
            d.use = d.type == kind
        device = kind
        break
if device is None:
    print("HELIOS_ERROR no GPU was found for Cycles", flush=True)
    sys.exit(3)
print("HELIOS_DEVICE", device, flush=True)
scene.render.engine = "CYCLES"
scene.cycles.device = "GPU"

# Three.js is Y-up, Blender Z-up: (x, y, z) -> (x, -z, y).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Ci = C.inverted()
def m3(a):  # three.js Matrix4.elements are column-major
    return Matrix([[a[0], a[4], a[8], a[12]], [a[1], a[5], a[9], a[13]], [a[2], a[6], a[10], a[14]], [a[3], a[7], a[11], a[15]]])
def to_b(v):
    return Vector((v[0], -v[2], v[1]))

f0, f1 = job["frameStart"], job["frameEnd"]
scene.render.fps = job["fps"]
scene.frame_start, scene.frame_end = f0, f1

# The scene. Lights come in at the Studio's own numbers (COMPAT: W = 4 pi cd),
# the same one-to-one mapping as the sun below.
try:
    bpy.ops.import_scene.gltf(filepath=job["glb"], export_import_convert_lighting_mode="COMPAT")
except TypeError:
    bpy.ops.import_scene.gltf(filepath=job["glb"])
bpy.context.view_layer.update()

# Things that move: the scene file holds them at the first frame; each frame's
# world matrix is applied as a change from that one, so any conversion the
# importer made to the object itself is kept.
for tr in job["tracks"]:
    ob = bpy.data.objects.get(tr["node"])
    if ob is None:
        print("HELIOS_WARN not in the scene:", tr["node"], flush=True)
        continue
    base = ob.matrix_world.copy()
    first_inv = m3(tr["m"][0]).inverted_safe()
    ob.rotation_mode = "QUATERNION"
    for i, a in enumerate(tr["m"]):
        ob.matrix_world = C @ (m3(a) @ first_inv) @ Ci @ base
        for path in ("location", "rotation_quaternion", "scale"):
            ob.keyframe_insert(path, frame=f0 + i)

# The shot camera: the Studio's lens on a 24 mm-high sensor, fitted vertically.
cam_data = bpy.data.cameras.new("HeliosShot")
cam_data.lens = job["lensMm"]
cam_data.sensor_fit = "VERTICAL"
cam_data.sensor_height = job["sensorMm"]
cam_data.clip_start = 0.05
cam_data.clip_end = 5000.0
cam = bpy.data.objects.new("HeliosShot", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_mode = "QUATERNION"
for i, a in enumerate(job["camera"]):
    loc, rot, _scale = (C @ m3(a)).decompose()
    cam.location, cam.rotation_quaternion = loc, rot
    if len(job["camera"]) > 1:
        cam.keyframe_insert("location", frame=f0 + i)
        cam.keyframe_insert("rotation_quaternion", frame=f0 + i)

# The sun, at the Studio's hour.
sun = job["sun"]
if sun["on"]:
    light = bpy.data.lights.new("HeliosSun", "SUN")
    light.energy = sun["strength"]
    light.color = sun["color"]
    light.angle = math.radians(1.0)
    ob = bpy.data.objects.new("HeliosSun", light)
    ob.rotation_euler = (-to_b(sun["dir"]).normalized()).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)

# The world: light from a sky-to-ground dome (the Studio's hemisphere fill),
# and the Studio's background where the camera sees the sky.
w = job["world"]
world = bpy.data.worlds.new("HeliosWorld")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld")
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
half = nt.nodes.new("ShaderNodeMath")
half.operation = "MULTIPLY_ADD"
half.inputs[1].default_value = 0.5
half.inputs[2].default_value = 0.5
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (*w["ground"], 1.0)
ramp.color_ramp.elements[1].color = (*w["sky"], 1.0)
fill = nt.nodes.new("ShaderNodeBackground")
fill.inputs["Strength"].default_value = w["strength"]
seen = nt.nodes.new("ShaderNodeBackground")
seen.inputs["Color"].default_value = (*w["background"], 1.0)
if w["mode"] == "physical":
    try:
        sky = nt.nodes.new("ShaderNodeTexSky")
        for t in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING", "HOSEK_WILKIE"):
            try:
                sky.sky_type = t
                break
            except TypeError:
                pass
        d = to_b(sun["dir"]).normalized()
        if hasattr(sky, "sun_elevation"):
            sky.sun_elevation = math.asin(max(-1.0, min(1.0, d.z)))
            sky.sun_rotation = math.atan2(d.x, d.y) % (2 * math.pi)
        if hasattr(sky, "sun_disc"):
            sky.sun_disc = False  # the sun lamp lights the scene; no second sun
        nt.links.new(sky.outputs["Color"], seen.inputs["Color"])
        seen.inputs["Strength"].default_value = 0.3
    except Exception as e:  # the plain background colour stays
        print("HELIOS_WARN sky:", e, flush=True)
path = nt.nodes.new("ShaderNodeLightPath")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], half.inputs[0])
nt.links.new(half.outputs[0], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], fill.inputs["Color"])
nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(fill.outputs[0], mix.inputs[1])
nt.links.new(seen.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs["Surface"])

# The film: a filmic look like the Studio's (ACES there).
for view in ("ACES 1.3", "ACES 2.0", "AgX", "Filmic"):
    try:
        scene.view_settings.view_transform = view
        break
    except TypeError:
        pass

r = scene.render
r.resolution_x, r.resolution_y, r.resolution_percentage = job["width"], job["height"], 100
r.film_transparent = False
r.use_persistent_data = True  # keep the scene on the GPU between frames
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGB"
scene.cycles.samples = job["samples"]
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = "OPTIX" if device == "OPTIX" else "OPENIMAGEDENOISE"
except TypeError:
    pass
try:
    scene.cycles.denoising_use_gpu = True
except AttributeError:
    pass

total = f1 - f0 + 1
for i, f in enumerate(range(f0, f1 + 1)):
    scene.frame_set(f)
    r.filepath = job["out"] + "/%04d.png" % f
    bpy.ops.render.render(write_still=True)
    print("HELIOS_FRAME", i + 1, total, flush=True)
print("HELIOS_DONE", flush=True)
'''


def _download(url: str, dest: pathlib.Path, limit: int) -> None:
    with urllib.request.urlopen(url, timeout=120) as res, open(dest, "wb") as f:
        got = 0
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            got += len(chunk)
            if got > limit:
                raise ValueError("the scene file is too big")
            f.write(chunk)


def _upload(url: str, data: bytes, content_type: str) -> None:
    # A Supabase signed upload address takes the file's bytes in one PUT.
    req = urllib.request.Request(url, data=data, method="PUT", headers={"content-type": content_type, "x-upsert": "true"})
    with urllib.request.urlopen(req, timeout=300) as res:
        if res.status >= 300:
            raise RuntimeError(f"upload answered {res.status}")


@app.function(
    image=render_image,
    gpu=GPU,
    cpu=CPU_CORES,
    memory=MEMORY_MIB,
    timeout=TIMEOUT_S,
    max_containers=MAX_CONTAINERS,
    retries=0,
)
def render(job: dict, glb_url: str, upload_url: str, content_type: str) -> dict:
    """One Blender render. Returns {"ok": True, seconds, render_seconds, device, frames, bytes} or {"ok": False, "error"}."""
    started = time.time()
    call_id = modal.current_function_call_id()
    work = pathlib.Path(tempfile.mkdtemp(prefix="helios-"))
    frames_dir = work / "frames"
    frames_dir.mkdir()
    try:
        glb = work / "scene.glb"
        _download(glb_url, glb, MAX_GLB_BYTES)
        spec = dict(job, glb=str(glb), out=str(frames_dir))
        (work / "job.json").write_text(json.dumps(spec))
        (work / "job.py").write_text(BLENDER_SCRIPT)
        total = int(job["frameEnd"]) - int(job["frameStart"]) + 1
        if call_id:
            progress[call_id] = {"done": 0, "total": total}

        device, tail = "", []
        t0 = time.time()
        proc = subprocess.Popen(
            [BLENDER, "-b", "--factory-startup", "--python", str(work / "job.py"), "--", str(work / "job.json")],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        for line in proc.stdout:
            tail = (tail + [line.rstrip()])[-30:]
            if line.startswith("HELIOS_DEVICE "):
                device = line.split()[1]
            elif line.startswith("HELIOS_FRAME ") and call_id:
                done, of = line.split()[1:3]
                progress[call_id] = {"done": int(done), "total": int(of)}
        code = proc.wait()
        render_seconds = time.time() - t0
        frames = sorted(frames_dir.glob("*.png"))
        if code != 0 or len(frames) != total:
            why = next((l[len("HELIOS_ERROR "):] for l in tail if l.startswith("HELIOS_ERROR ")), "")
            print("\n".join(tail))
            return {"ok": False, "error": why or f"Blender stopped (code {code}) after {len(frames)} of {total} frames."}

        if job["kind"] == "still":
            out = frames[0]
        else:
            out = work / "render.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(int(job["fps"])), "-start_number", str(int(job["frameStart"])),
                 "-i", str(frames_dir / "%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow",
                 "-movflags", "+faststart", str(out)],
                check=True,
            )
        data = out.read_bytes()
        if len(data) > MAX_RESULT_BYTES:
            return {"ok": False, "error": "The result was too big to keep."}
        _upload(upload_url, data, content_type)
        return {
            "ok": True,
            "seconds": round(time.time() - started, 1),
            "render_seconds": round(render_seconds, 1),
            "device": device,
            "frames": total,
            "bytes": len(data),
        }
    except Exception as e:  # said plainly to the Studio, with no addresses in it
        return {"ok": False, "error": str(e).split("?")[0][:300]}
    finally:
        if call_id:
            try:
                progress.pop(call_id)
            except Exception:
                pass


@app.function(image=web_image)
@modal.asgi_app(requires_proxy_auth=True)
def api():
    from fastapi import FastAPI, HTTPException

    web = FastAPI()

    @web.post("/render")
    async def start(body: dict):
        job, glb_url, upload_url = body.get("job"), body.get("glb_url"), body.get("upload_url")
        content_type = body.get("content_type")
        # The website checked the job (cycles.ts validateCyclesJob); this only
        # refuses what could never be a render.
        if not isinstance(job, dict) or job.get("kind") not in ("still", "animation"):
            raise HTTPException(400, "no job")
        if not all(isinstance(u, str) and u.startswith("https://") for u in (glb_url, upload_url)):
            raise HTTPException(400, "addresses must be https")
        if content_type not in ("image/png", "video/mp4"):
            raise HTTPException(400, "unknown result type")
        call = await render.spawn.aio(job, glb_url, upload_url, content_type)
        return {"call_id": call.object_id}

    @web.get("/result/{call_id}")
    async def result(call_id: str):
        try:
            out = await modal.FunctionCall.from_id(call_id).get.aio(timeout=0)
        except OutputExpiredError:
            return {"state": "expired"}
        except FunctionTimeoutError:
            return {"state": "timeout"}
        except TimeoutError:
            p = await progress.get.aio(call_id) or {}
            return {"state": "running", "done": p.get("done", 0), "total": p.get("total", 0)}
        except Exception as e:
            return {"state": "failed", "error": str(e)[:300]}
        if not out.get("ok"):
            return {"state": "failed", "error": out.get("error", "")}
        return {"state": "done", **{k: out[k] for k in ("seconds", "render_seconds", "device", "frames", "bytes")}}

    return web
