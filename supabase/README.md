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

## Privileges are not in the snapshot — the verifier probes them

`schema.sql` records tables, columns, indexes, policies and functions. It does
NOT record who may execute a function or update a column, and the applied
files undercount those too: on 2026-09-09 a security pass found a function
"revoked" in its applied file that still answered the anonymous key with
other people's email addresses (the revoke named `anon, authenticated` but
not `public`, and both roles inherit from PUBLIC), a column grant on
`profiles` that existed only in the dashboard, and six storage policies the
same way. Three rules came out of it:

1. **A revoke names all three:** `REVOKE ... FROM public, anon, authenticated;`
   then `GRANT EXECUTE ... TO service_role;`. Every new `SECURITY DEFINER`
   function gets this in the same file that creates it, below the CREATE.
2. **`scripts/verify-db.mjs` probes privileges, not files.** Its
   `PRIVATE_RPCS` list is called with the anon key and arguments that match
   nothing; each must answer 42501. `src/lib/generations/truth-contracts.test.ts`
   fails the suite if a `SECURITY DEFINER` function in the snapshot is in
   neither that list nor the test's callable-by-design list.
3. **What the API cannot show, the operator reads from the catalog.** Column
   grants (`information_schema.role_column_grants`) and storage policies
   (`pg_policies where schemaname = 'storage'`) are one read-only query each
   in the SQL editor, pasted back into chat. Ask for one narrow query at a
   time; the editor truncates wide results.
