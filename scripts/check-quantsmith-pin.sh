#!/usr/bin/env bash
# Advisory gate — reports drift between the QuantSmith commit recorded in
# docs/specs/spec005/QUANTSMITH_PIN.md and the sibling repo's current HEAD.
#
# QuantSmith's own hooks/stages/quantsmith-version-check.sh gate cannot run
# here: it looks for a `quantsmith==X.Y.Z` pin in requirements.txt/
# pyproject.toml and an importable Python package, neither of which exists in
# this Node/Vite repo (spec 0047, RISK-004). This script is the documented
# fallback for an artifact-only consumer: track the reviewed commit by hand,
# report drift, never block.
#
# Advisory only, always exits 0. Skips cleanly when the sibling repo isn't
# checked out locally (e.g. CI), matching QuantSmith's own gates' "degrade
# gracefully when files are missing" design.

set -uo pipefail

PIN_FILE="docs/specs/spec005/QUANTSMITH_PIN.md"
QS_DIR="../agentic_workflows/qf_workflow_sdk_public"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "QuantSmith pin check: $PIN_FILE not found, skipped."
  exit 0
fi

pinned_commit=$(grep -m1 '| Commit |' "$PIN_FILE" | sed -E 's/.*`([0-9a-f]{7,40})`.*/\1/')

if [[ -z "$pinned_commit" ]]; then
  echo "QuantSmith pin check: could not read a pinned commit from $PIN_FILE, skipped."
  exit 0
fi

if [[ ! -d "$QS_DIR/.git" ]]; then
  echo "QuantSmith pin check: sibling repo not found at $QS_DIR, skipped."
  echo "Pinned commit on record: $pinned_commit"
  exit 0
fi

current_commit=$(git -C "$QS_DIR" rev-parse HEAD 2>/dev/null || echo "")

if [[ -z "$current_commit" ]]; then
  echo "QuantSmith pin check: could not read HEAD from $QS_DIR, skipped."
  exit 0
fi

if [[ "$current_commit" == "$pinned_commit" ]]; then
  echo "QuantSmith pin check PASSED — sibling repo at pinned commit ($pinned_commit)."
  exit 0
fi

if git -C "$QS_DIR" merge-base --is-ancestor "$pinned_commit" "$current_commit" 2>/dev/null; then
  behind=$(git -C "$QS_DIR" rev-list --count "${pinned_commit}..${current_commit}" 2>/dev/null || echo "?")
  echo "QuantSmith pin check: DRIFT — sibling repo is $behind commit(s) ahead of the pin."
  echo "  Pinned:  $pinned_commit"
  echo "  Current: $current_commit"
  echo "  Re-review docs/specs/spec005/SPEC.md's cited files before further spec005 work."
else
  echo "QuantSmith pin check: DRIFT — sibling repo HEAD is not a descendant of the pin"
  echo "  (rebase, reset, or a different branch checked out). Manual review needed."
  echo "  Pinned:  $pinned_commit"
  echo "  Current: $current_commit"
fi

exit 0
