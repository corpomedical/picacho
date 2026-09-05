# Database change log

The live database is the truth; this directory is its paper trail. Three
parts:

- **`applied/<date>/*.sql`** — every SQL file the operator has pasted into the
  Supabase SQL editor and confirmed ran, filed under the date it was written
  (which is, in practice, the date it was applied — the deploy flow applies
  SQL before the code push that depends on it). Files here are HISTORY: never
  edit or re-run one; a correction is a new file under `pending/`.
- **`pending/*.sql`** — written but NOT yet applied. The deploy rule is
  SQL-first: everything here must be pasted into the SQL editor (and confirmed)
  BEFORE pushing code that depends on it, then the file moves to
  `applied/<date>/` in the same commit as that code. Every file is idempotent
  (`IF NOT EXISTS` / `CREATE OR REPLACE`) so a double-paste is harmless.
- **`schema.sql`** — a point-in-time snapshot of the full schema, stale by
  however many applied files postdate it. Re-snapshot from the dashboard
  (Database → Schema, or `supabase db dump` where the CLI is linked) after big
  rounds; `scripts/verify-db.mjs` is the mechanical check that the LIVE
  database has every column, function, RPC, and bucket the code depends on —
  run it read-only against production whenever in doubt:

  ```bash
  node scripts/verify-db.mjs
  ```

This layout closed the 2026-09-05 flaw-hunt finding that truth lived in three
unsynced copies with no record of what was applied — the drift class that
shipped the Basic-tier billing bug (a buyer would have been charged while the
plan upgrade silently failed, unfixed for 12 days).
