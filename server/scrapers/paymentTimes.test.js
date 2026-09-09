'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const fs = require('fs');
const { parseAllRows, DATASET_KEY, searchPaymentTimes } = require('./paymentTimes');
const { replaceDatasetRecords, diskCachePath, diskFailureMarkerPath } = require('./datasetStore');

// ── Minimal valid ZIP builder ────────────────────────────────────────────────
// extractZipEntry() only reads the EOCD record, Central Directory entries
// (compSize/fnLen/extraLen/commentLen/localOffset/filename), and each Local File
// Header (lfnLen/lExtraLen) — it never checks CRC32, so this only needs to be
// spec-accurate in the fields that function actually reads.
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [filename, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(filename, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const compData = zlib.deflateRawSync(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;
    const localEntry = Buffer.concat([localHeader, nameBuf, compData]);
    localParts.push(localEntry);
    offset += localEntry.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);

  return Buffer.concat([localData, centralData, eocd]);
}

const SHARED_STRINGS = (nameHeader, abnHeader) => `<sst>` +
  `<si><t>${nameHeader}</t></si>` +      // 0
  `<si><t>${abnHeader}</t></si>` +       // 1
  `<si><t>acn</t></si>` +                // 2
  `<si><t>type</t></si>` +               // 3
  `<si><t>period start</t></si>` +       // 4
  `<si><t>period end</t></si>` +         // 5
  `<si><t>standard term</t></si>` +      // 6
  `<si><t>average day</t></si>` +        // 7
  `<si><t>30</t></si>` +                 // 8
  `<si><t>31 60</t></si>` +              // 9
  `<si><t>more 60</t></si>` +            // 10
  `<si><t>Acme Constructions Pty Ltd</t></si>` + // 11
  `<si><t>Large</t></si>` +              // 12
  `</sst>`;

const HEADER_ROW =
  `<row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" t="s"><v>2</v></c>` +
  `<c r="E2" t="s"><v>3</v></c><c r="F2" t="s"><v>4</v></c><c r="G2" t="s"><v>5</v></c>` +
  `<c r="M2" t="s"><v>6</v></c><c r="U2" t="s"><v>7</v></c><c r="Y2" t="s"><v>8</v></c>` +
  `<c r="Z2" t="s"><v>9</v></c><c r="AA2" t="s"><v>10</v></c></row>`;

// Real XLSX cells always carry at least a style attribute (s="N") even with no type —
// cellRe (paymentTimes.js) requires a literal space after r="..." to match, mirroring
// that real-world shape, so numeric cells here include a dummy s="0" attribute.
const DATA_ROW =
  `<row r="3"><c r="B3" t="s"><v>11</v></c><c r="C3" s="0"><v>12345678901</v></c><c r="D3" s="0"><v>123456789</v></c>` +
  `<c r="E3" t="s"><v>12</v></c><c r="F3" s="0"><v>45000</v></c><c r="G3" s="0"><v>45090</v></c>` +
  `<c r="M3" s="0"><v>30</v></c><c r="U3" s="0"><v>45.5</v></c><c r="Y3" s="0"><v>60.2</v></c>` +
  `<c r="Z3" s="0"><v>30.1</v></c><c r="AA3" s="0"><v>9.7</v></c></row>`;

function buildWorkbook({ nameHeader = 'business name', abnHeader = 'abn' } = {}) {
  return buildZip({
    'xl/sharedStrings.xml': SHARED_STRINGS(nameHeader, abnHeader),
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${HEADER_ROW}${DATA_ROW}</sheetData></worksheet>`,
  });
}

function clearCache() {
  try { fs.unlinkSync(diskCachePath(DATASET_KEY)); } catch { /* fine if absent */ }
  try { fs.unlinkSync(diskFailureMarkerPath(DATASET_KEY)); } catch { /* fine if absent */ }
}

// -------------------------------------------------------------------
// parseAllRows — pure function, no I/O
// -------------------------------------------------------------------

test('parseAllRows — discovers header columns correctly and parses the data row', () => {
  const { rows, headerIssues } = parseAllRows(buildWorkbook());
  assert.equal(headerIssues.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Acme Constructions Pty Ltd');
  assert.equal(rows[0].abn, '12345678901');
  assert.equal(rows[0].acn, '123456789');
  assert.equal(rows[0].type, 'Large');
  assert.equal(rows[0].avgDays, '45.5');
});

test('parseAllRows — skips a row with no name (blank/padding row)', () => {
  const blank = buildZip({
    'xl/sharedStrings.xml': SHARED_STRINGS('business name', 'abn'),
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${HEADER_ROW}<row r="3"></row></sheetData></worksheet>`,
  });
  const { rows } = parseAllRows(blank);
  assert.equal(rows.length, 0);
});

test('parseAllRows — flags a header validation issue when the name column cannot be found (simulated column-shift)', () => {
  // Simulates the historical Section 8.3 bug: the register's header text changed to
  // something discover() can't match against any of its known hints.
  const shifted = buildWorkbook({ nameHeader: 'xyz123', abnHeader: 'abn' });
  const { headerIssues } = parseAllRows(shifted);
  assert.equal(headerIssues.length, 1);
  assert.match(headerIssues[0], /name column not found/);
});

test('parseAllRows — flags a header validation issue when the ABN column cannot be found', () => {
  const shifted = buildWorkbook({ nameHeader: 'business name', abnHeader: 'qqq999' });
  const { headerIssues } = parseAllRows(shifted);
  assert.equal(headerIssues.length, 1);
  assert.match(headerIssues[0], /ABN column not found/);
});

test('parseAllRows — a missing header row (no row 2 at all) is flagged, not silently defaulted', () => {
  const noHeader = buildZip({
    'xl/sharedStrings.xml': SHARED_STRINGS('business name', 'abn'),
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${DATA_ROW}</sheetData></worksheet>`,
  });
  const { headerIssues } = parseAllRows(noHeader);
  assert.equal(headerIssues.length, 1);
  assert.match(headerIssues[0], /no header row/);
});

// -------------------------------------------------------------------
// searchPaymentTimes — reads via datasetStore's disk-fallback path (no
// DATABASE_URL in tests), same pattern as the migrated asicDpnDataset tests.
// -------------------------------------------------------------------

test('searchPaymentTimes — matches by name substring against ingested rows', async () => {
  clearCache();
  try {
    const { rows } = parseAllRows(buildWorkbook());
    await replaceDatasetRecords(DATASET_KEY, rows.map((r) => ({ payload: r, abn: r.abn, normalisedName: r.name.toLowerCase() })), {}, null);

    const result = await searchPaymentTimes('Acme Constructions', '', '');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, 'Acme Constructions Pty Ltd');
    assert.equal(result.results[0].metadata['Average payment time'], '45.5 days');
  } finally {
    clearCache();
  }
});

test('searchPaymentTimes — matches by exact ABN even without a name match', async () => {
  clearCache();
  try {
    const { rows } = parseAllRows(buildWorkbook());
    await replaceDatasetRecords(DATASET_KEY, rows.map((r) => ({ payload: r, abn: r.abn, normalisedName: r.name.toLowerCase() })), {}, null);

    const result = await searchPaymentTimes('', '12345678901', '');
    assert.equal(result.results.length, 1);
  } finally {
    clearCache();
  }
});

test('searchPaymentTimes — no match returns an honest empty result, not an error', async () => {
  clearCache();
  try {
    const { rows } = parseAllRows(buildWorkbook());
    await replaceDatasetRecords(DATASET_KEY, rows.map((r) => ({ payload: r, abn: r.abn, normalisedName: r.name.toLowerCase() })), {}, null);

    const result = await searchPaymentTimes('Totally Unrelated Company', '', '');
    assert.equal(result.results.length, 0);
    assert.match(result.summary, /No payment times data found/);
  } finally {
    clearCache();
  }
});

test('searchPaymentTimes — nothing ever ingested reports an honest "not yet available", not a false clean', async () => {
  clearCache();
  const result = await searchPaymentTimes('Acme Constructions', '', '');
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /not yet available/);
});
