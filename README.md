# Picacho

The reliability layer for AI-generated character content — a Next.js app.

## Running it on your computer (first time only)

You need two things installed once: **Node.js** (you already have it) and this folder's packages.

1. Open the **Terminal** app on your Mac (Spotlight search → type "Terminal" → Enter).
2. Paste this, then press Enter. It moves Terminal into this project folder:

   ```
   cd ~/Documents/Picacho
   ```

3. Paste this, then press Enter. It downloads all the packages the project needs (only required once, or after big changes):

   ```
   npm install
   ```

4. Paste this, then press Enter. It starts the app on your computer:

   ```
   npm run dev
   ```

5. Open your browser to **http://localhost:3000** — you should see a "Picacho" card confirming the scaffold works.

To stop the app, click back into Terminal and press `Control + C`.

You'll re-run step 4 (`npm run dev`) each time you want to preview changes; steps 2–3 only need to happen again if told to.

## What's in here

- `src/app/` — every screen (App Router)
- `.env.example` — the list of secret keys the app will need (Supabase, Stripe, AI providers) as those get connected. Copy it to `.env.local` and fill in real values when instructed — `.env.local` is never uploaded to GitHub.
