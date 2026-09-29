# Picacho's Modal apps

`helios_cycles.py` is Helios Studio's Blender render machine: Render ▸ "Blender render (Cycles)" in the Studio sends the scene here, Blender renders it on one NVIDIA L40S GPU, and the picture or video comes back to the Studio. It is for admins first (`HELIOS_CYCLES_FOR_ALL = false` in `src/lib/sets/set-config.ts`), and admins are charged no credits.

What it costs (Modal's prices, read 2026-09-29): about $0.00063 a second while a render runs (GPU $0.000542 + 4 CPU cores + 16 GiB memory). Nothing while idle. The Starter plan includes $30 of compute a month. The Studio's window shows an estimate before you press, and the measured seconds and dollars after. One render is stopped after 100 minutes at most (≈ $3.78), and at most two run at once.

## Switch it on (once)

You do these steps yourself: they need your own Modal account and keys.

1. **Make the account.** Go to <https://modal.com>, sign up, and choose the Starter plan (free, with $30 of compute a month).
2. **Install Modal's tool on your Mac.** Open Terminal and paste:
   ```
   pip3 install modal
   ```
3. **Connect the tool to your account.** In Terminal:
   ```
   python3 -m modal setup
   ```
   A browser page opens; approve it. Terminal says it's connected.
4. **Deploy the render machine.** In Terminal, from the Picacho folder:
   ```
   cd ~/Picacho
   python3 -m modal deploy modal/helios_cycles.py
   ```
   The first deploy takes a few minutes (it downloads Blender 5.2.2 once and checks it). At the end it prints a web address ending in `.modal.run` for `api`. Copy it.
5. **Make the key the website uses.** In the Modal dashboard: **Settings → Proxy Auth Tokens** (it may be called "Proxy Tokens") **→ New token**. It shows a **Token ID** (starts `wk-`) and a **Token Secret** (starts `ws-`). The secret is shown once; keep the page open for the next step.
6. **Give the website the three values.** In Vercel: the Picacho project → **Settings → Environment Variables**, add for Production (and Preview if you like):
   - `MODAL_CYCLES_URL` = the `.modal.run` address from step 4 (no slash at the end)
   - `MODAL_KEY` = the Token ID (`wk-…`)
   - `MODAL_SECRET` = the Token Secret (`ws-…`)
7. **Redeploy the website** (Vercel → Deployments → the latest → Redeploy), so it reads the new values.

Until all three values are there, the Studio says "Blender renders aren't switched on yet." and nothing is sent.

## The first proof render

Open a set in Helios Studio as an admin → Render ▸ **Blender render (Cycles) — still** → 1080p, 256 samples → Render. The window shows the time it took, the GPU it ran on (OptiX or CUDA) and what it cost. Use that time to correct the estimate (`CYCLES_START_SECONDS` and `CYCLES_SECONDS_PER_MP_SAMPLE` in `src/lib/sets/cycles.ts`).

## Changing it later

Edit `helios_cycles.py`, then run step 4's deploy again. The GPU, cores and memory are written in two places that must match: the top of `helios_cycles.py` and the top of `src/lib/sets/cycles.ts`.

Blender is free software under the GNU GPL; running it unchanged on our own server is allowed, and the renders belong to whoever made them.
