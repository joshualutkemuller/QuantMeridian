# QuantSmith Pin Record

Market Terminal does not `pip install quantsmith` (see `spec005`'s Explicit
Non-Goals), so QuantSmith's own `hooks/stages/quantsmith-version-check.sh`
gate cannot fire here — it looks for a `quantsmith==X.Y.Z` line in
`requirements.txt`/`pyproject.toml` and an importable package, neither of
which exists in a Node/Vite repo. Spec `0047` documents this exact gap as
`RISK-004` and names the fallback: for a consumer that only reads rendered
artifacts, the guard is `schema_version` on the payload itself, not the
package pin.

This file is that fallback's record for everything Market Terminal has
actually looked at or consumed from QuantSmith so far — narrower than a
package pin, but the same idea: a reviewed-against commit, so drift is
visible instead of silent.

## Current Pin

| Field | Value |
| --- | --- |
| Repo | `joshualutkemuller/QuantSmith` (local path: `../agentic_workflows/qf_workflow_sdk_public`) |
| Commit | `d57cb67257b35a6759f1d5c049c0a78e4fff730d` |
| Commit date | 2026-08-29 |
| `pyproject.toml` version | `0.1.0` (no Git tags cut yet as of this pin) |
| Reviewed by | Claude, for Joshua, while authoring `spec005` |
| Reviewed for | `README.md`, `specs/0045-fred-point-in-time/spec.md`, `specs/0047-downstream-contract/spec.md`, `specs/0059-morning-market-brief/spec.md`, `agents/economists/README.md`, `adapters/dashboard_render/README.md` + `specs/0017-dashboard-render-adapters/spec.md` |

## What This Pin Covers

Only the synergy claims made in `docs/specs/spec005/SPEC.md` are validated
against this commit. It does **not** mean every QuantSmith spec, agent, or
gate has been reviewed — the SDK has 52+ specs and 162 agents; spec005
inventories a handful with a real, confirmed connection to Market Terminal.

## Updating This Pin

Re-review is needed before treating a newer QuantSmith commit as the basis
for further spec005 work when any of the reviewed files above have changed
upstream, or before starting spec005 Phase 2 (the narrative-drafting pilot).
`scripts/check-quantsmith-pin.sh` reports (advisory, non-blocking) how far
the sibling checkout has drifted from the commit recorded here.
