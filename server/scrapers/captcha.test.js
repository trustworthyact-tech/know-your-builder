const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solveCaptcha, SITE_KEY } = require('./captcha');

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

// Build a fake axios that returns the given responses in order.
// Each element of `responses` is either { data } or an Error to throw.
function fakeHttp(responses) {
  let index = 0;
  return {
    get: async (_url, _opts) => {
      const res = responses[index++];
      if (res instanceof Error) throw res;
      return res;
    },
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

test('solveCaptcha — returns token on first poll when status=1', async () => {
  const http = fakeHttp([
    // Submission response
    { data: { status: 1, request: 'task-123' } },
    // Poll response — immediately ready
    { data: { status: 1, request: 'TOKEN_ABCDEF' } },
  ]);

  // Override poll interval to 0 so the test runs instantly
  const original = global.setTimeout;
  global.setTimeout = (fn, _ms) => original(fn, 0);
  try {
    const token = await solveCaptcha('https://example.com', 'mykey', http);
    assert.equal(token, 'TOKEN_ABCDEF');
  } finally {
    global.setTimeout = original;
  }
});

test('solveCaptcha — polls multiple times before token arrives', async () => {
  const http = fakeHttp([
    { data: { status: 1, request: 'task-456' } },          // submit
    { data: { status: 0, request: 'CAPCHA_NOT_READY' } },  // poll 1 — not ready
    { data: { status: 0, request: 'CAPCHA_NOT_READY' } },  // poll 2 — not ready
    { data: { status: 1, request: 'TOKEN_XYZ' } },         // poll 3 — ready
  ]);

  const original = global.setTimeout;
  global.setTimeout = (fn, _ms) => original(fn, 0);
  try {
    const token = await solveCaptcha('https://example.com', 'mykey', http);
    assert.equal(token, 'TOKEN_XYZ');
  } finally {
    global.setTimeout = original;
  }
});

test('solveCaptcha — throws when submission returns status 0', async () => {
  const http = fakeHttp([
    { data: { status: 0, request: 'ERROR_WRONG_USER_KEY' } },
  ]);

  await assert.rejects(
    () => solveCaptcha('https://example.com', 'badkey', http),
    /2captcha submission failed: ERROR_WRONG_USER_KEY/
  );
});

test('solveCaptcha — throws when poll returns an unexpected error code', async () => {
  const http = fakeHttp([
    { data: { status: 1, request: 'task-789' } },
    { data: { status: 0, request: 'ERROR_CAPTCHA_UNSOLVABLE' } },
  ]);

  const original = global.setTimeout;
  global.setTimeout = (fn, _ms) => original(fn, 0);
  try {
    await assert.rejects(
      () => solveCaptcha('https://example.com', 'mykey', http),
      /2captcha poll error: ERROR_CAPTCHA_UNSOLVABLE/
    );
  } finally {
    global.setTimeout = original;
  }
});

test('solveCaptcha — throws when the HTTP submission call itself fails', async () => {
  const http = fakeHttp([new Error('Network unreachable')]);

  await assert.rejects(
    () => solveCaptcha('https://example.com', 'mykey', http),
    /Network unreachable/
  );
});

test('SITE_KEY constant is the known ASIC reCAPTCHA site key', () => {
  assert.equal(SITE_KEY, '6LdfxBoUAAAAAO7ItWGgMWT32_h5T_TtD4F1MflL');
});
