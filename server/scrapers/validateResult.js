'use strict';

// Hand-rolled shape check on a scraper's resolved result — matches index.js's existing
// validateSearchFields() rather than introducing a schema-validation library (no such
// library is used anywhere in server/, a documented convention). Called from runScraper()
// after fn() resolves, before send() — a safety net at the one place all scraper output
// already funnels through, not a change to any individual scraper.
//
// Non-fatal by design: logs and returns the result unchanged rather than dropping it or
// throwing, matching this codebase's "never silently present as fresh/clean" philosophy —
// a malformed-but-real result should still reach the user, just with a loud log line for
// whoever's watching the health check.
function assertValidResult(key, result) {
  const problems = [];

  if (typeof result !== 'object' || result === null) {
    problems.push('result is not an object');
  } else {
    const hasResultsArray =
      Array.isArray(result.results) ||
      Array.isArray(result.licenceResults) ||
      Array.isArray(result.adjudicationResults) ||
      Array.isArray(result.enforcementResults);
    if (!hasResultsArray) problems.push('missing results[]/licenceResults[]/adjudicationResults[]/enforcementResults[]');
    if (typeof result.summary !== 'string') problems.push('missing summary string');
  }

  if (problems.length > 0) {
    console.warn(`[validateResult] ${key}: ${problems.join('; ')}`);
  }

  // WS0.2 contract fields — stamped here rather than in every individual scraper, since
  // this is the one place all scraper output already funnels through. A scraper that
  // already set its own `completeness` (e.g. a manual-fallback result, or courtRecords.js's
  // own anyFailed/allFailed tracking) wins over the default — this only fills in what a
  // scraper didn't already decide for itself.
  //
  // Some scrapers resolve (rather than throw) their own honest failure as `status: 'error'`
  // — courtRecords.js's allFailed case is the example that surfaced this. Defaulting those
  // to `completeness: 'complete'` would silently contradict their own status field, so the
  // default tracks it instead of being a flat constant.
  if (typeof result === 'object' && result !== null) {
    return {
      completeness: result.status === 'error' ? 'unavailable' : 'complete',
      asOf: new Date().toISOString(),
      ...result,
    };
  }

  return result;
}

module.exports = { assertValidResult };
