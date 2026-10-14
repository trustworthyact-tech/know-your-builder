'use strict';

// Registers every Phase 3 ingestion job (DATA_SOURCES_PLAN.md Phase 3). index.js starts them;
// searchOrchestrator.js reads the indexes. See runner.js for the shared behaviour.
const runner = require('./runner');
const asicNotices = require('./asicNotices');
const actJudgments = require('./actJudgments');
const fwoReleases = require('./fwoReleases');

asicNotices.register();
actJudgments.register();
fwoReleases.register();

module.exports = { ...runner, asicNotices, actJudgments, fwoReleases };
