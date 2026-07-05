#!/usr/bin/env bash
# Run all register accuracy tests that do not require a CAPTCHA key in parallel.
# Must be executed from the repo root: bash server/tests/run-all.sh
# For the ASIC live test (needs CAPTCHA_API_KEY) see README.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Export server/.env so child processes inherit API keys (e.g. SCRAPERAPI_KEY for AustLII).
if [ -f server/.env ]; then
  while IFS= read -r _line; do
    [[ -z "$_line" || "$_line" == \#* ]] && continue
    export "$_line"
  done < server/.env
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Register Accuracy Tests — Parallel Run"
echo "  Working directory: $REPO_ROOT"
echo "══════════════════════════════════════════════════════════"
echo ""

LOG_DIR="$(mktemp -d)"

run_test() {
  local label="$1"
  local file="$2"
  local log="$LOG_DIR/${label}.log"
  node "$file" > "$log" 2>&1
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label  (see output below)"
  fi
  echo $exit_code > "$LOG_DIR/${label}.exit"
}

# Launch all tests concurrently
run_test "asic-parser"          "server/tests/test-asic-disqualified-parser.js" &
run_test "vicbpc"               "server/tests/test-vicbpc.js" &
run_test "wa-building"          "server/tests/test-wa-building.js" &
run_test "qbcc-excluded"        "server/tests/test-qbcc-excluded.js" &
run_test "nsw-fairtrading"      "server/tests/test-nsw-fairtrading-licence.js" &
run_test "vic-vba-licence"      "server/tests/test-vic-vba-licence.js" &
run_test "wa-be-licence"        "server/tests/test-wa-be-licence.js" &
run_test "sa-cbs-licence"       "server/tests/test-sa-cbs-licence.js" &
run_test "nt-building-licence"  "server/tests/test-nt-building-licence.js" &
run_test "act-licence"          "server/tests/test-act-licence.js" &
run_test "tas-cbos-licence"     "server/tests/test-tas-cbos-licence.js" &
# Section 8.2 — State/Territory Licence Registers (scraper functions)
run_test "act-licences"              "server/tests/test-act-licences.js" &
run_test "nsw-fairtrading-scraper"   "server/tests/test-nsw-fairtrading.js" &
run_test "nt-building-practitioners" "server/tests/test-nt-building-practitioners.js" &
run_test "wa-licence-register"       "server/tests/test-wa-licence-register.js" &
run_test "vic-vba-licence"           "server/tests/test-vic-vba-licence-scraper.js" &
# Section 8.3 — Financial Risk Signals
run_test "asic-insolvency"      "server/tests/test-asic-insolvency.js" &
run_test "ato-debt"             "server/tests/test-ato-debt.js" &
run_test "payment-times"        "server/tests/test-payment-times.js" &
run_test "modern-slavery"       "server/tests/test-modern-slavery.js" &
# Section 8.4 — Payment & Subcontractor Disputes
run_test "qbcc-adjudication"   "server/tests/test-qbcc-adjudication.js" &
# Section 8.5 — Courts, Enforcement & Disciplinary
run_test "austlii"              "server/tests/test-austlii.js" &
run_test "fwo"                  "server/tests/test-fwo.js" &

wait
echo ""

# Print output for any failed tests
OVERALL=0
for label in asic-parser vicbpc wa-building qbcc-excluded nsw-fairtrading vic-vba-licence wa-be-licence sa-cbs-licence nt-building-licence act-licence tas-cbos-licence act-licences nsw-fairtrading-scraper nt-building-practitioners wa-licence-register vic-vba-licence asic-insolvency ato-debt payment-times modern-slavery qbcc-adjudication austlii fwo; do
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

# Always print full output for all tests (verbose mode)
if [ "${VERBOSE:-}" = "1" ]; then
  for label in asic-parser vicbpc wa-building qbcc-excluded nsw-fairtrading vic-vba-licence wa-be-licence sa-cbs-licence nt-building-licence act-licence tas-cbos-licence act-licences nsw-fairtrading-scraper nt-building-practitioners wa-licence-register vic-vba-licence asic-insolvency ato-debt payment-times modern-slavery qbcc-adjudication austlii fwo; do
    echo "──────────────────────────────────────────────────────────"
    echo "  Output: $label"
    echo "──────────────────────────────────────────────────────────"
    cat "$LOG_DIR/${label}.log"
    echo ""
  done
fi

rm -rf "$LOG_DIR"

if [ $OVERALL -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "SOME TESTS FAILED — see output above"
fi
echo ""
exit $OVERALL
