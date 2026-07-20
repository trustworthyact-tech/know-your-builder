#!/usr/bin/env bash
# Run all Section 8.3 Financial Risk Signals tests in parallel.
# Includes AFSA NPII (deep-check), which is excluded from run-all.sh.
#
# Usage (from repo root):
#   bash server/tests/run-s83.sh
#   VERBOSE=1 bash server/tests/run-s83.sh
#
# To supply a fixed fixture name to a specific test (skips auto-discovery):
#   S83_INSOLVENCY_NAME="Acme Pty Ltd" bash server/tests/run-s83.sh
#   S83_ATODEBT_NAME="Acme Pty Ltd"    bash server/tests/run-s83.sh
#   S83_PAYMENT_NAME="BHP"             bash server/tests/run-s83.sh
#   S83_SLAVERY_NAME="Lendlease"       bash server/tests/run-s83.sh
#   S83_AFSA_NAME="Smith"              bash server/tests/run-s83.sh
#
# Sub-agent prompt for any individual test:
#   See server/tests/README.md — "Section 8.3 sub-agent prompts"
#
# Typical run time: ~60–120s (bottleneck is the two Puppeteer tests)

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
echo "  Section 8.3 — Financial Risk Signals Tests"
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

# Launch all 5 tests concurrently.
# Each is standalone — no shared state, safe to parallelise.

name_arg() {
  local val="$1"
  if [ -n "$val" ]; then echo "--name" "$val"; fi
}

run_test "asic-insolvency" "server/tests/test-asic-insolvency.js" \
  $(name_arg "${S83_INSOLVENCY_NAME:-}") &

run_test "ato-debt" "server/tests/test-ato-debt.js" \
  $(name_arg "${S83_ATODEBT_NAME:-}") &

run_test "payment-times" "server/tests/test-payment-times.js" \
  $(name_arg "${S83_PAYMENT_NAME:-}") &

run_test "modern-slavery" "server/tests/test-modern-slavery.js" \
  $(name_arg "${S83_SLAVERY_NAME:-}") &

# AFSA NPII is deep-check only but still part of section 8.3.
# Included here; excluded from run-all.sh.
run_test "afsa-npii" "server/tests/test-afsa-npii.js" \
  $(name_arg "${S83_AFSA_NAME:-}") &

wait
echo ""

LABELS="asic-insolvency ato-debt payment-times modern-slavery afsa-npii"
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
  echo "ALL SECTION 8.3 TESTS PASSED"
else
  echo "SOME SECTION 8.3 TESTS FAILED — see output above"
  echo ""
  echo "Sub-agent prompts for individual tests:"
  echo "  See server/tests/README.md — 'Section 8.3 sub-agent prompts'"
fi
echo ""
exit $OVERALL
