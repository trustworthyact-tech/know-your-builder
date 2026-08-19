const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { solveCaptcha } = require('./captcha');

puppeteer.use(StealthPlugin());

let browserInstance = null;
let launchPromise = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = 120_000;

// Every scraper that needs a browser (11 of them as of 2026-08) shares this one
// Chromium instance. Several do CAPTCHA solves or sit in a WAF-challenge wait loop
// with a hard ~15s timeout — when `server/index.js` fires all scrapers concurrently
// via Promise.all, too many of those loops running at once starve each other of
// CPU and the WAF challenge doesn't clear in time, so unrelated registers (e.g. SA
// licence + ASIC insolvency + ATO debt) fail together even though each works fine
// in isolation. Gate concurrent pages here — the one place all scrapers pass
// through — instead of touching every call site.
const MAX_CONCURRENT_PAGES = Number(process.env.PUPPETEER_MAX_CONCURRENT_PAGES) || 3;
let activePageCount = 0;
const pageWaitQueue = [];

function acquirePageSlot() {
  if (activePageCount < MAX_CONCURRENT_PAGES) {
    activePageCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => pageWaitQueue.push(resolve));
}

// Hands the freed slot straight to the next waiter rather than decrementing —
// keeps activePageCount accurate without a separate wake-up + re-acquire step.
function releasePageSlot() {
  const next = pageWaitQueue.shift();
  if (next) next();
  else activePageCount--;
}

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  }, IDLE_TIMEOUT_MS);
}

// Wraps browser.newPage() so every existing call site (`browser.newPage()`) is
// automatically concurrency-gated with no changes required elsewhere. The slot
// releases when the page closes — scrapers already close their page in a
// `finally` block, so this piggybacks on that without any new cleanup burden.
function attachPageGate(b) {
  const originalNewPage = b.newPage.bind(b);
  b.newPage = async (...args) => {
    await acquirePageSlot();
    let page;
    try {
      page = await originalNewPage(...args);
    } catch (err) {
      releasePageSlot();
      throw err;
    }
    page.once('close', releasePageSlot);
    return page;
  };
  return b;
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
    attachPageGate(b);
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
// via 2captcha, fires the ADF callback with the token, and returns rendered HTML.
// Throws if captchaApiKey is absent.
async function fetchAdfPageWithCaptcha(url, captchaApiKey) {
  if (!captchaApiKey) throw new Error('CAPTCHA_API_KEY not set');

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 3_000));

    const token = await solveCaptcha(url, captchaApiKey);

    await page.evaluate((t) => {
      const ta = document.getElementById('g-recaptcha-response');
      if (ta) ta.value = t;
      const widget = document.querySelector('[data-callback]');
      const name = widget?.dataset?.callback;
      if (name && typeof window[name] === 'function') window[name](t);
      else window.isTemplRecaptchaSuccessful?.(t);
    }, token);

    await new Promise((r) => setTimeout(r, 1_500));
    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2_000));

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

// ASIC Connect DPN (Disqualified Persons) search.
//
// The DPN form's surname/givenName fields have zero bounding boxes in headless mode and
// cannot be filled via keyboard events. Instead we intercept the ADF XHR POST that fires
// when the Go button is clicked and inject the required fields + 2captcha token directly
// into the POST body. This bypasses both the DOM interaction problem and the fact that
// isTemplRecaptchaSuccessful is never exposed on window.
//
// Field constants are the ADF component IDs for the DPN search form.
const DPN_URL = 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm';
const DPN_F_TYPE = 'bnConnectionTemplate:pt_s5:templateSearchTypesListOfValuesId';
const DPN_F_SURNAME = 'bnConnectionTemplate:pt_s5:searchSurname';
const DPN_F_FIRSTNAME = 'bnConnectionTemplate:pt_s5:searchFirstName';
const DPN_GO_BTN = '[id="bnConnectionTemplate:pt_s5:searchButtonId"]';

async function fetchAdfDpnSearch(surname, givenName, captchaApiKey) {
  if (!captchaApiKey) throw new Error('CAPTCHA_API_KEY not set');

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(DPN_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 2_000));

    // Solve CAPTCHA while the page settles — token must exist before clicking Go.
    const token = await solveCaptcha(DPN_URL, captchaApiKey);

    // When Go is clicked, ADF fires a POST without the CAPTCHA token (the
    // isTemplRecaptchaSuccessful callback is never exposed on window in headless
    // mode). We intercept that POST and inject all required DPN form fields + the
    // token so ASIC's server receives a valid, complete request.
    await page.setRequestInterception(true);
    let injected = false;

    page.on('request', async (req) => {
      try {
        if (
          !injected &&
          req.method() === 'POST' &&
          req.url().includes('connectonline.asic.gov.au') &&
          req.url().includes('Adf-Window-Id') &&
          (req.postData() || '').includes(DPN_F_SURNAME + '=')
        ) {
          injected = true;
          let body = req.postData() || '';
          body = body.replace(DPN_F_TYPE + '=', DPN_F_TYPE + '=4');
          body = body.replace(DPN_F_SURNAME + '=', `${DPN_F_SURNAME}=${encodeURIComponent(surname)}`);
          body = body.replace(DPN_F_FIRSTNAME + '=', `${DPN_F_FIRSTNAME}=${encodeURIComponent(givenName || '')}`);
          body += '&g-recaptcha-response=' + encodeURIComponent(token);
          await req.continue({ postData: body });
        } else {
          await req.continue();
        }
      } catch { /* ignore detached-frame errors after ADF navigation */ }
    });

    let clickErr = null;
    await page.click(DPN_GO_BTN).catch((err) => { clickErr = err; });

    await page.waitForNetworkIdle({ timeout: 20_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2_000));

    // Under concurrent load the Go button can be not-yet-ready when clicked, or the
    // click can land but ADF's POST never fires in time — either way `injected` stays
    // false and page.content() is just the untouched search form. That parses as a
    // legitimate "zero matches" result downstream, which is a false negative: the
    // search was never actually submitted. Throw so callers retry instead of trusting it.
    if (!injected) {
      throw new Error(
        `DPN search POST never fired for "${surname}, ${givenName}"` +
          (clickErr ? ` (Go button click failed: ${clickErr.message})` : ' (Go button clicked but no POST intercepted)')
      );
    }

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { getBrowser, fetchWithBrowser, fetchWithBrowserSearch, fetchAdfPageWithCaptcha, fetchAdfDpnSearch };
