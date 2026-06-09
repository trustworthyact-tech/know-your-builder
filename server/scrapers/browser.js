const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { solveCaptcha } = require('./captcha');

puppeteer.use(StealthPlugin());

let browserInstance = null;
let launchPromise = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = 120_000;

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  }, IDLE_TIMEOUT_MS);
}

async function getBrowser() {
  if (browserInstance) {
    scheduleClose();
    return browserInstance;
  }

  // Prevent concurrent launches: if a launch is already in progress, wait for it.
  if (launchPromise) return launchPromise;

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--disable-accelerated-2d-canvas',
  ];

  launchPromise = puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : 'shell',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: launchArgs,
  }).then((b) => {
    browserInstance = b;
    launchPromise = null;
    b.on('disconnected', () => {
      browserInstance = null;
      launchPromise = null;
      clearTimeout(idleTimer);
    });
    scheduleClose();
    return b;
  }).catch((err) => {
    launchPromise = null;
    throw err;
  });

  return launchPromise;
}

// Returns the rendered HTML of a page after bot-protection challenges have resolved.
// Waits up to `challengeTimeoutMs` for Cloudflare / AWS WAF JS challenges to clear.
async function fetchWithBrowser(url, { challengeTimeoutMs = 15_000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait until the page is no longer a Cloudflare or WAF challenge page.
    const deadline = Date.now() + challengeTimeoutMs;
    while (Date.now() < deadline) {
      const title = await page.title();
      const isChallenge =
        title === 'Just a moment...' ||
        title === 'Please Wait...' ||
        title === 'Attention Required!' ||
        title === '';
      if (!isChallenge) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

// Navigates to a page with a List.js search box, types a query, waits for the
// client-side filter to apply, then returns the filtered HTML.
// selector: CSS selector for the search input (e.g. '#listjs-search')
async function fetchWithBrowserSearch(url, query, inputSelector, { challengeTimeoutMs = 15_000, settleMs = 2_000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    const deadline = Date.now() + challengeTimeoutMs;
    while (Date.now() < deadline) {
      const title = await page.title();
      const isChallenge =
        title === 'Just a moment...' ||
        title === 'Please Wait...' ||
        title === 'Attention Required!' ||
        title === '';
      if (!isChallenge) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    await page.waitForSelector(inputSelector, { timeout: 10_000 });
    await page.click(inputSelector);
    await page.type(inputSelector, query, { delay: 80 });
    // Wait for List.js to filter results
    await new Promise((r) => setTimeout(r, settleMs));

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

// Navigates to an Oracle ADF page protected by reCAPTCHA invisible, solves the challenge
// via 2captcha, injects the token into the ADF callback, waits for search results, and
// returns rendered HTML. Throws if captchaApiKey is absent.
async function fetchAdfPageWithCaptcha(url, captchaApiKey) {
  if (!captchaApiKey) throw new Error('CAPTCHA_API_KEY not set');

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Allow ADF framework and reCAPTCHA widget to fully initialise before solving
    await new Promise((r) => setTimeout(r, 3_000));

    const token = await solveCaptcha(url, captchaApiKey);

    // Fill the hidden textarea reCAPTCHA expects, then fire the ADF callback that
    // re-queues the search with the valid token attached.
    await page.evaluate((t) => {
      const textarea = document.getElementById('g-recaptcha-response');
      if (textarea) textarea.value = t;
      window.isExtRecaptchaSuccessful?.(t);
    }, token);

    // Wait for the results table to appear — more reliable than networkidle2 here
    // because ADF fires partial-page XHR updates after the reCAPTCHA callback fires.
    await page
      .waitForSelector('table tbody tr', { timeout: 25_000 })
      .catch(() => {});

    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2_000));

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { getBrowser, fetchWithBrowser, fetchWithBrowserSearch, fetchAdfPageWithCaptcha };
