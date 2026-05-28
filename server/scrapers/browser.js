const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let browserInstance = null;
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

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--disable-accelerated-2d-canvas',
  ];

  browserInstance = await puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS === 'true' ? 'shell' : false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: launchArgs,
  });

  browserInstance.on('disconnected', () => {
    browserInstance = null;
    clearTimeout(idleTimer);
  });

  scheduleClose();
  return browserInstance;
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

module.exports = { getBrowser, fetchWithBrowser, fetchWithBrowserSearch };
