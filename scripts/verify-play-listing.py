#!/usr/bin/env python3
"""Verify PLAY_LISTING.md against Google Play's metadata limits.

Parses every `<!-- count:KEY -->` tag followed by a ```text fenced block,
counts Unicode characters exactly as written (newlines included, trailing
newline of the block excluded), enforces the Play limit for the field kind,
and cross-checks the count stated in the nearest preceding heading
("### App name — 28/30"). Exits non-zero on any violation or mismatch, so
copy edits that silently blow a limit — or drift from the stated counts —
fail loudly before anyone pastes them into Play Console.
"""
import re
import sys
from pathlib import Path

DOC = Path(__file__).resolve().parent.parent / "PLAY_LISTING.md"
LIMITS = {"name": 30, "short": 80, "full": 4000}

text = DOC.read_text(encoding="utf-8")

# <!-- count:KEY --> then a ```text ... ``` fence
block_re = re.compile(r"<!-- count:([a-z]+\.[a-z]+) -->\s*\n```text\n(.*?)\n```", re.DOTALL)
# nearest preceding "### ... — N/limit" heading for each block
heading_re = re.compile(r"^###.*?— (\d+)/(\d+)\s*$", re.MULTILINE)

blocks = list(block_re.finditer(text))
if len(blocks) != 12:
    sys.exit(f"expected 12 tagged blocks (4 languages x 3 fields), found {len(blocks)}")

rows, failures = [], []
for m in blocks:
    key, body = m.group(1), m.group(2)
    kind = key.split(".")[1]
    limit = LIMITS[kind]
    n = len(body)

    stated = None
    for h in heading_re.finditer(text, 0, m.start()):
        stated = (int(h.group(1)), int(h.group(2)))  # keep the last one before the block
    ok_limit = n <= limit
    ok_stated = stated is not None and stated == (n, limit)
    if not ok_limit:
        failures.append(f"{key}: {n} chars exceeds Play limit {limit}")
    if not ok_stated:
        failures.append(f"{key}: heading states {stated}, measured {n}/{limit}")
    rows.append((key, n, limit, "OK" if ok_limit and ok_stated else "FAIL"))

print(f"{'field':10} {'chars':>5} {'limit':>5}  status")
print("-" * 34)
for key, n, limit, status in rows:
    print(f"{key:10} {n:>5} {limit:>5}  {status}")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("\nAll 12 fields within Play limits; stated counts match measured counts.")
