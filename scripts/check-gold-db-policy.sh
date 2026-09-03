#!/usr/bin/env bash
# CI grep gate — enforces the Gold DB migration policy (§11).
#
# Fails the build if any Tier A API route (econ/*, market/*, chart/*) imports
# the FRED live client, SIM generators, snapshot fallback, or the old Phase 6
# fallback annotations. These are forbidden in Tier A production paths after
# the cutover.
#
# Deliberate exceptions:
#   - econ/fomc and econ/macro-inputs: explicit SIM is a documented synthetic
#     model/book fallback, not a silent Tier A series fallback.

set -euo pipefail

TIER_A_DIRS=(
  "src/app/api/econ"
  "src/app/api/market"
  "src/app/api/chart"
  "src/app/api/market-publishing"
)

EXEMPT_FILES=(
  "src/app/api/econ/fomc/route.ts"
  "src/app/api/econ/macro-inputs/route.ts"
)

# Patterns that must not appear in Tier A route files after full cutover.
FORBIDDEN_PATTERNS=(
  "MIGRATION FALLBACK"
  "from \"@/lib/server/fred\""
  "fredSeries"
  "fredLatest"
  "getSeriesHistory"
  "getSeriesHistoryRaw"
  "from \"@/data/econSnapshot\""
  "getSnapshotObservations"
  "getSnapshotRawObservations"
  "MARKET_SNAPSHOT_FALLBACK"
  "snapshotFallbackEnabled"
  "simFallbackEnabled"
)

ERRORS=0

for dir in "${TIER_A_DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    matches=$(grep -rn --include="*.ts" "$pattern" "$dir" 2>/dev/null \
      | grep -v "\.test\.ts:" \
      | grep -v "^Binary" \
      || true)
    for exempt in "${EXEMPT_FILES[@]}"; do
      matches=$(printf "%s\n" "$matches" | grep -v "^${exempt}:" || true)
    done
    if [[ -n "$matches" ]]; then
      echo "POLICY VIOLATION: '$pattern' found in Tier A route(s):"
      echo "$matches"
      echo ""
      ERRORS=$((ERRORS + 1))
    fi
  done
done

if [[ $ERRORS -gt 0 ]]; then
  echo "Gold DB policy check FAILED: $ERRORS forbidden pattern(s) in Tier A routes."
  echo "Tier A routes must read from GoldStore (MACRO_DB_URL) only."
  echo "See docs/features/GOLD_DB_MIGRATION_HANDOFF.md §11 for the enforcement checklist."
  exit 1
fi

echo "Gold DB policy check PASSED — no forbidden fallback patterns in Tier A routes."
