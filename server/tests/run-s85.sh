#!/usr/bin/env bash
# Run all Section 8.5 Courts, Enforcement & Disciplinary tests in parallel.
#
# Usage (from repo root):
#   bash server/tests/run-s85.sh
#   VERBOSE=1 bash server/tests/run-s85.sh
#
# To supply a fixed fixture name to a specific test (skips auto-discovery):
#   S85_AUSTLII_NAME="Ballard"    bash server/tests/run-s85.sh
#   S85_FWO_NAME="Yooralla"       bash server/tests/run-s85.sh
#   S85_QBCC_NAME="Nash"          bash server/tests/run-s85.sh
#
# Sub-agent prompt for any individual test:
#   See server/tests/README.md — "Section 8.5 sub-agent prompts"
#
# Typical run time: ~20–40s

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -f server/.env ]; then
  while IFS= read -r _line; do
    [[ -z "$_line" || "$_line" == \#* ]] && continue
    export "$_line"
  done < server/.env
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Section 8.5 — Courts, Enforcement & Disciplinary Tests"
echo "  Working directory: $REPO_ROOT"
echo "══════════════════════════════════════════════════════════"
echo ""

LOG_DIR="$(mktemp -d)"

run_test() {
  local label="$1"
  local file="$2"
  shift 2
  local log="$LOG_DIR/${label}.log"
  node "$file" "$@" > "$log" 2>&1
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    printf "  PASS  %s\n" "$label"
  else
    printf "  FAIL  %s  (see output below)\n" "$label"
  fi
  echo $exit_code > "$LOG_DIR/${label}.exit"
}

name_arg() {
  local val="$1"
  if [ -n "$val" ]; then echo "--name" "$val"; fi
}

# Launch all 3 tests concurrently — no shared state, safe to parallelise.

run_test "austlii" "server/tests/test-austlii.js" \
  $(name_arg "${S85_AUSTLII_NAME:-}") &

run_test "fwo" "server/tests/test-fwo.js" \
  $(name_arg "${S85_FWO_NAME:-}") &

run_test "qbcc-adjudication" "server/tests/test-qbcc-adjudication.js" \
  $(name_arg "${S85_QBCC_NAME:-}") &

wait
echo ""

LABELS="austlii fwo qbcc-adjudication"
OVERALL=0

for label in $LABELS; do
  exit_code=$(cat "$LOG_DIR/${label}.exit" 2>/dev/null || echo 1)
  if [ "$exit_code" != "0" ]; then
    OVERALL=1
    echo "──────────────────────────────────────────────────────────"
    echo "  FAIL output: $label"
    echo "──────────────────────────────────────────────────────────"
    cat "$LOG_DIR/${label}.log"
    echo ""
  fi
done

if [ "${VERBOSE:-}" = "1" ]; then
  for label in $LABELS; do
    echo "──────────────────────────────────────────────────────────"
    echo "  Output: $label"
    echo "──────────────────────────────────────────────────────────"
    cat "$LOG_DIR/${label}.log"
    echo ""
  done
fi

rm -rf "$LOG_DIR"

if [ $OVERALL -eq 0 ]; then
  echo "ALL SECTION 8.5 TESTS PASSED"
else
  echo "SOME SECTION 8.5 TESTS FAILED — see output above"
  echo ""
  echo "Sub-agent prompts for individual tests:"
  echo "  See server/tests/README.md — 'Section 8.5 sub-agent prompts'"
fi
echo ""
exit $OVERALL
