import { configDefaults, defineConfig } from "vitest/config";

// The only job of this file is to keep the test suite measuring THIS
// codebase.
//
// There was no vitest config at all, so the runner used its default include
// pattern — every *.test.* anywhere under the repo root. That swept in
// .claude/worktrees/, where agent sessions keep full checkouts of the project:
// on 2026-09-04 the suite reported 126 files and 1,544 tests against 42 real
// test files, the rest belonging to three abandoned copies. A green run was
// partly a statement about code nobody was going to ship, and a stale copy
// with a failing test would have blocked a gate it has no business gating.
//
// Deliberately an EXCLUDE rather than an include of "src/**": a test that
// lands somewhere legitimate but new — scripts/, a package/ — should still be
// picked up. Only the worktrees are cut.
//
// configDefaults.exclude is spread in because specifying `exclude` REPLACES
// vitest's defaults rather than adding to them; dropping it would put
// node_modules and dist back in scope.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
