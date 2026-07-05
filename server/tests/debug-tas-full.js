'use strict';
require('dotenv').config();
const axios = require('axios');
const { getBrowser } = require('../scrapers/browser');

const SEARCH_URL = 'https://occupationallicensing.justice.tas.gov.au/Search/OnlineSearch.aspx';
const TAS_SITE_KEY = '6LfXOWUUAAAAAMFRq3rPzSX2piSfoeyA6d3lt47c';

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 120_000;

async function solveCaptchaForPage(pageUrl, siteKey, apiKey) {
  console.log('[captcha] submitting to 2captcha...');
  const submitUrl =
    `https://2captcha.com/in.php` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&method=userrecaptcha` +
    `&googlekey=${encodeURIComponent(siteKey)}` +
    `&pageurl=${encodeURIComponent(pageUrl)}` +
    `&invisible=0` +
    `&json=1`;
  const { data: submitData } = await axios.get(submitUrl, { timeout: 30_000 });
  if (!submitData || submitData.status !== 1) throw new Error(`2captcha: ${submitData?.request}`);
  const taskId = submitData.request;
  console.log('[captcha] taskId:', taskId);
  const pollUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(taskId)}&json=1`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const { data: pollData } = await axios.get(pollUrl, { timeout: 15_000 });
    if (pollData?.status === 1) { console.log('[captcha] solved!'); return pollData.request; }
    if (pollData?.request !== 'CAPCHA_NOT_READY') throw new Error(`2captcha poll: ${pollData?.request}`);
    console.log('[captcha] not ready yet...');
  }
  throw new Error('2captcha timeout');
}

(async () => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  try {
    console.log('Step 1: Navigating...');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 1000));
    console.log('Page title:', await page.title());

    console.log('Step 2: Clicking BSP radio...');
    await page.click('input[type="radio"][value="14"]');
    await new Promise(r => setTimeout(r, 2000));

    console.log('Step 3: Clicking Company radio (47)...');
    await page.click('input[type="radio"][value="47"]');
    await new Promise(r => setTimeout(r, 2000));

    const siteKey = await page.evaluate(() => document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey')) || TAS_SITE_KEY;
    console.log('CAPTCHA sitekey:', siteKey);

    console.log('Step 4: Solving CAPTCHA...');
    const token = await solveCaptchaForPage(SEARCH_URL, siteKey, process.env.CAPTCHA_API_KEY);
    console.log('Token (first 40 chars):', token.slice(0, 40));

    await page.evaluate((t) => {
      const ta = document.getElementById('g-recaptcha-response');
      if (ta) ta.value = t;
      const ta2 = document.querySelector('textarea[name="g-recaptcha-response"]');
      if (ta2) ta2.value = t;
    }, token);

    console.log('Step 5: Filling business name...');
    const bizId = 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_txtBusinessNameSearch';
    const bizInput = await page.$('#' + bizId);
    console.log('bizInput found:', !!bizInput);
    if (bizInput) {
      await bizInput.click({ clickCount: 3 });
      await bizInput.type('Lendlease', { delay: 50 });
      console.log('Typed Lendlease');
    }

    console.log('Step 6: Clicking submit...');
    const submitId = 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_btnFilterMainGrid';
    const btn = await page.$('#' + submitId);
    if (btn) await btn.click();
    else { console.log('Submit button not found!'); }

    await new Promise(r => setTimeout(r, 3000));
    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    const html = await page.content();
    console.log('Page URL after submit:', page.url());
    console.log('HTML length:', html.length);

    // Check for results table or error message
    const pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const firstTable = html.match(/<table[^>]*>[\s\S]{0,500}/)?.[0] ?? 'no table found';
    console.log('Tables count:', (html.match(/<table/g) || []).length);
    console.log('First table snippet:', firstTable.replace(/<[^>]+>/g, ' ').slice(0, 300));

    // Check for any error or info message
    const errorMsg = pageText.match(/error|invalid|incorrect|no results|not found/i)?.[0];
    console.log('Error-like text:', errorMsg || 'none');

    // Show 500 chars of visible text around the word "Invalid"
    const invalidIdx = pageText.toLowerCase().indexOf('invalid');
    if (invalidIdx >= 0) console.log('Context around "Invalid":', pageText.slice(Math.max(0, invalidIdx-100), invalidIdx+200));

    // Show text around results/gridview areas
    const gridIdx = html.toLowerCase().indexOf('gridview');
    if (gridIdx >= 0) {
      const snippet = html.slice(gridIdx, gridIdx + 1000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.log('GridView area text:', snippet.slice(0, 400));
    }

    // Show all table text
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    $('table').each((i, t) => {
      const text = $(t).text().replace(/\s+/g, ' ').trim().slice(0, 200);
      if (text.length > 20) console.log('Table ' + i + ':', text);
    });

  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    await page.close();
    process.exit(0);
  }
})();
