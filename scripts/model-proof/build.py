"""The Helios model proof: build a model from each photo, score it against all of them.

Run by run.sh on a GPU pod, inside TRELLIS.2's environment. For every photo
in --photos it:

  1. builds a textured model with TRELLIS.2 (our own copy, MIT licence),
  2. renders it all the way round (36 views, every 10 degrees),
  3. exports it as a GLB the Helios stage can load,

and then scores every model against EVERY photo: for each pair, how close
the model's best-matching view comes to the photo, as the cosine of DINOv2
embeddings (Meta, Apache 2.0). The score a model gets against the photo it
was built from is expected to be high; the scores against the OTHER photos
are the test — a car built from its front has to still be your car from the
side and the back. The numbers are a rough judge; the contact sheet is what
to look at.

Writes to --out: <photo>.glb, <photo>-turntable.mp4, contact.jpg,
report.json and report.txt (with the time each build took and what that
time cost at --usd-per-hour).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def as_frames(value):
    """Rendered frames as a list of HxWx3 uint8 arrays, whatever shape they came in."""
    import numpy as np
    import torch

    if isinstance(value, torch.Tensor):
        value = value.detach().cpu().numpy()
    frames = list(value) if not isinstance(value, list) else value
    out = []
    for f in frames:
        if isinstance(f, torch.Tensor):
            f = f.detach().cpu().numpy()
        f = np.asarray(f)
        if f.ndim == 3 and f.shape[0] in (1, 3, 4) and f.shape[-1] not in (1, 3, 4):
            f = np.transpose(f, (1, 2, 0))
        if f.dtype != np.uint8:
            f = np.clip(f * (255.0 if f.max() <= 1.0 else 1.0), 0, 255).astype(np.uint8)
        if f.ndim == 2:
            f = np.stack([f] * 3, axis=-1)
        out.append(f[:, :, :3])
    return out


def on_black(image):
    """A preprocessed photo on black, the background every view is rendered on."""
    from PIL import Image

    if image.mode == "RGBA":
        ground = Image.new("RGB", image.size, (0, 0, 0))
        ground.paste(image, mask=image.split()[3])
        return ground
    return image.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--trellis", required=True)
    ap.add_argument("--pipeline-type", default="1024_cascade", choices=["512", "1024", "1024_cascade", "1536_cascade"])
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--views", type=int, default=36)
    # RunPod's A100 80GB on-demand price, read at source 2026-09-24. Pass
    # the pod's own price if it is another GPU.
    ap.add_argument("--usd-per-hour", type=float, default=1.59)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    photos = sorted(p for p in Path(args.photos).iterdir() if p.suffix.lower() in PHOTO_EXT)
    if not photos:
        sys.exit(f"No photos in {args.photos}")

    sys.path.insert(0, args.trellis)
    os.chdir(args.trellis)  # its example loads assets/hdri by relative path

    import cv2
    import imageio
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps
    import o_voxel
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from trellis2.renderers import EnvMap
    from trellis2.utils import render_utils

    t = time.perf_counter()
    pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    pipeline.cuda()
    load_s = time.perf_counter() - t
    print(f"model loaded in {load_s:.1f} s")

    envmap = EnvMap(
        torch.tensor(
            cv2.cvtColor(cv2.imread("assets/hdri/forest.exr", cv2.IMREAD_UNCHANGED), cv2.COLOR_BGR2RGB),
            dtype=torch.float32,
            device="cuda",
        )
    )

    # Every photo, upright (a phone's rotation is in its EXIF) and cut out
    # the way the pipeline cuts it before it builds.
    originals = {p.stem: ImageOps.exif_transpose(Image.open(p)) for p in photos}
    cutouts = {name: on_black(pipeline.preprocess_image(img.copy())) for name, img in originals.items()}

    builds = {}
    for p in photos:
        name = p.stem
        print(f"\n— building from {p.name}")
        torch.cuda.synchronize()
        t = time.perf_counter()
        mesh = pipeline.run(originals[name], seed=args.seed, pipeline_type=args.pipeline_type)[0]
        torch.cuda.synchronize()
        build_s = time.perf_counter() - t
        mesh.simplify(16777216)  # nvdiffrast's limit, as TRELLIS.2's own example does

        t = time.perf_counter()
        rendered = render_utils.render_video(mesh, resolution=512, num_frames=args.views, envmap=envmap)
        key = next((k for k in ("shaded", "color", "base_color") if k in rendered), None)
        if key is None:
            sys.exit(f"The renderer returned none of shaded/color/base_color: {list(rendered)}")
        views = as_frames(rendered[key])
        if "alpha" in rendered:
            alphas = as_frames(rendered["alpha"])
            views = [(v.astype(np.float32) * (a[:, :, :1].astype(np.float32) / 255.0)).astype(np.uint8) for v, a in zip(views, alphas)]
        imageio.mimsave(out / f"{name}-turntable.mp4", views, fps=12)
        render_s = time.perf_counter() - t

        t = time.perf_counter()
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=500000,
            texture_size=2048,
            remesh=True,
            remesh_band=1,
            remesh_project=0,
            verbose=False,
        )
        glb_path = out / f"{name}.glb"
        glb.export(str(glb_path), extension_webp=True)
        export_s = time.perf_counter() - t

        builds[name] = {"views": views, "build_s": build_s, "render_s": render_s, "export_s": export_s, "glb_mb": glb_path.stat().st_size / 1e6}
        print(f"  built {build_s:.1f} s · rendered {render_s:.1f} s · exported {export_s:.1f} s · {builds[name]['glb_mb']:.1f} MB")
        del mesh
        torch.cuda.empty_cache()

    # THE JUDGE: DINOv2, which none of the above was tuned against.
    from transformers import AutoImageProcessor, AutoModel

    proc = AutoImageProcessor.from_pretrained("facebook/dinov2-base")
    judge = AutoModel.from_pretrained("facebook/dinov2-base").cuda().eval()

    @torch.no_grad()
    def embed(images):
        vecs = []
        for i in range(0, len(images), 16):
            batch = proc(images=[Image.fromarray(x) if isinstance(x, np.ndarray) else x for x in images[i : i + 16]], return_tensors="pt").to("cuda")
            v = judge(**batch).pooler_output
            vecs.append(torch.nn.functional.normalize(v, dim=-1))
        return torch.cat(vecs)

    photo_names = list(cutouts)
    photo_vecs = embed([cutouts[n] for n in photo_names])
    scores = {}
    best_view = {}
    for m, b in builds.items():
        view_vecs = embed(b["views"])
        sims = photo_vecs @ view_vecs.T  # photos × views
        best = sims.max(dim=1)
        scores[m] = {photo_names[i]: round(float(best.values[i]), 4) for i in range(len(photo_names))}
        best_view[m] = {photo_names[i]: int(best.indices[i]) for i in range(len(photo_names))}

    # THE CONTACT SHEET: the photos across the top; under each, the view of
    # each model that comes closest to it, with its score.
    cell = 256
    sheet = Image.new("RGB", ((len(photo_names) + 1) * cell, (len(builds) + 1) * cell + 24), (17, 18, 22))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 8), "photos →", fill=(236, 237, 241))
    for j, n in enumerate(photo_names):
        sheet.paste(cutouts[n].resize((cell, cell)), ((j + 1) * cell, 24))
        draw.text(((j + 1) * cell + 6, 6), n[:30], fill=(236, 237, 241))
    for i, m in enumerate(builds):
        y = (i + 1) * cell + 24
        draw.text((8, y + 8), f"model from\n{m[:24]}", fill=(240, 205, 166))
        for j, n in enumerate(photo_names):
            v = Image.fromarray(builds[m]["views"][best_view[m][n]]).resize((cell, cell))
            sheet.paste(v, ((j + 1) * cell, y))
            own = " (own photo)" if n == m else ""
            draw.text(((j + 1) * cell + 6, y + cell - 18), f"{scores[m][n]:.3f}{own}", fill=(236, 237, 241))
    sheet.save(out / "contact.jpg", quality=90)

    rate = args.usd_per_hour / 3600.0
    report = {
        "trellis_pipeline_type": args.pipeline_type,
        "seed": args.seed,
        "gpu": torch.cuda.get_device_name(0),
        "usd_per_hour": args.usd_per_hour,
        "model_load_s": round(load_s, 1),
        "models": {
            m: {
                "build_s": round(b["build_s"], 1),
                "build_usd": round(b["build_s"] * rate, 4),
                "render_s": round(b["render_s"], 1),
                "export_s": round(b["export_s"], 1),
                "glb_mb": round(b["glb_mb"], 1),
                "score_own_photo": scores[m][m],
                "score_other_photos": {n: s for n, s in scores[m].items() if n != m},
                "mean_other_photos": round(float(np.mean([s for n, s in scores[m].items() if n != m])), 4) if len(scores[m]) > 1 else None,
            }
            for m, b in builds.items()
        },
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))

    lines = [
        f"TRELLIS.2 {args.pipeline_type}, seed {args.seed}, on {report['gpu']} at ${args.usd_per_hour}/h",
        f"model load {load_s:.1f} s (once per pod start)",
        "",
        "model built from        build     cost      own photo   other photos (mean)",
    ]
    for m, r in report["models"].items():
        other = f"{r['mean_other_photos']:.3f}" if r["mean_other_photos"] is not None else "—"
        lines.append(f"{m[:22]:<22}  {r['build_s']:>6.1f} s  ${r['build_usd']:<7.4f}  {r['score_own_photo']:.3f}       {other}")
    lines += [
        "",
        "Scores are DINOv2 cosine: 1.000 is identical. 'Other photos' is the test —",
        "how well a model built from ONE photo still matches the car from the others.",
        "Look at contact.jpg before trusting any number.",
    ]
    (out / "report.txt").write_text("\n".join(lines) + "\n")
    print("\n" + "\n".join(lines))


if __name__ == "__main__":
    main()
