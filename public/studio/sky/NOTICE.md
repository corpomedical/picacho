# Helios Studio · Photographed sky

Helios Studio offers **World ▸ Sky ▸ Photographed sky** only when a file is served here as `sky.hdr`
(`src/lib/sets/studio-realism.ts` `STUDIO_SKY_URL`). The file is not in the repository yet: it is
added by hand, on the operator's go-ahead.

Suggested file: **Kloofendal 48d Partly Cloudy (Pure Sky)**, 1K `.hdr`, from Poly Haven
(https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky). Authors: Greg Zaal (original),
Jarod Guest (sky edits).

Licence: **CC0**. Poly Haven's licence page (https://polyhaven.com/license, read 2026-09-30):
"You can use our assets for any purpose, including commercial work." and "You do not need to give
credit or attribution when using them (although it is appreciated)."

To add it (a 1K HDR is about 1–2 MB):

```bash
curl -L -o public/studio/sky/sky.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr
```
