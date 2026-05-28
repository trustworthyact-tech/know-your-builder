const axios = require('axios');

const SITE_KEY = '6LdfxBoUAAAAAO7ItWGgMWT32_h5T_TtD4F1MflL';
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 120_000;

// Submits an invisible reCAPTCHA task to 2captcha and polls until the token is ready.
// Throws on submission error, API error, or timeout — callers must handle gracefully.
// _http is injectable for testing; production callers omit it and get the real axios.
async function solveCaptcha(pageUrl, apiKey, _http = axios) {
  const submitUrl =
    `https://2captcha.com/in.php` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&method=userrecaptcha` +
    `&googlekey=${encodeURIComponent(SITE_KEY)}` +
    `&pageurl=${encodeURIComponent(pageUrl)}` +
    `&invisible=1` +
    `&json=1`;

  const { data: submitData } = await _http.get(submitUrl, { timeout: 30_000 });

  if (!submitData || submitData.status !== 1) {
    throw new Error(`2captcha submission failed: ${submitData?.request ?? 'unknown error'}`);
  }

  const taskId = submitData.request;
  const pollUrl =
    `https://2captcha.com/res.php` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&action=get` +
    `&id=${encodeURIComponent(taskId)}` +
    `&json=1`;

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const { data: pollData } = await _http.get(pollUrl, { timeout: 15_000 });

    if (pollData?.status === 1) {
      return pollData.request;
    }

    if (pollData?.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2captcha poll error: ${pollData?.request ?? 'unknown error'}`);
    }
  }

  throw new Error(`2captcha timeout: no token received within ${MAX_WAIT_MS / 1000}s`);
}

module.exports = { solveCaptcha, SITE_KEY };
