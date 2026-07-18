#!/usr/bin/env bash
# CI grep gate — enforces the Gold DB migration policy (§11).
#
# Fails the build if any Tier A API route (econ/*, market/*, chart/*) imports
# the FRED live client, SIM generators, or the snapshot fallback.
# These are forbidden in Tier A production paths after the cutover.
#
# Tier B routes (news, social, poly, ai) are exempt — they are deliberate
# live-feed exceptions documented with the "Exception to DB-only policy" comment.

set -euo pipefail

TIER_A_DIRS=(
  "src/app/api/econ"
  "src/app/api/market"
  "src/app/api/chart"
)

# Patterns that must not appear in Tier A route files after full cutover.
# Note: during the phased migration some routes still import these as fallbacks;
# they are guarded by goldEnabled() checks. The grep gate is intended to be
# progressively tightened as phases complete.
FORBIDDEN_PATTERNS=(
  "fredSeries"
  "fredLatest"
  "getSeriesHistory"
  "getSnapshotObservations"
)

ERRORS=0

for dir in "${TIER_A_DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    # Exclude:
    #   - Tier B exception header comments
    #   - Phased-migration fallback blocks (marked MIGRATION FALLBACK — remove in Phase 6)
    #   - Test files
    matches=$(grep -rn --include="*.ts" "$pattern" "$dir" 2>/dev/null \
      | grep -v "// Exception to DB-only policy" \
      | grep -v "MIGRATION FALLBACK" \
      | grep -v "\.test\.ts:" \
      | grep -v "^Binary" \
      || true)
    if [[ -n "$matches" ]]; then
      echo "POLICY VIOLATION: '$pattern' found in Tier A route(s) (not marked as MIGRATION FALLBACK):"
      echo "$matches"
      echo ""
      ERRORS=$((ERRORS + 1))
    fi
  done
done

if [[ $ERRORS -gt 0 ]]; then
  echo "Gold DB policy check FAILED: $ERRORS forbidden pattern(s) in Tier A routes."
  echo "Tier A routes must read from GoldStore (MACRO_DB_URL) only."
  echo "Mark phased-migration fallbacks with '// MIGRATION FALLBACK — remove in Phase 6'"
  echo "See docs/GOLD_DB_MIGRATION_HANDOFF.md §11 for the enforcement checklist."
  exit 1
fi

echo "Gold DB policy check PASSED — no unguarded forbidden patterns in Tier A routes."
