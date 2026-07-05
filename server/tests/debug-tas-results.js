'use strict';
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { getBrowser } = require('../scrapers/browser');

const SEARCH_URL = 'https://occupationallicensing.justice.tas.gov.au/Search/OnlineSearch.aspx';
const TAS_SITE_KEY = '6LfXOWUUAAAAAMFRq3rPzSX2piSfoeyA6d3lt47c';

async function solveCaptchaForPage(pageUrl, siteKey, apiKey) {
  console.log('[captcha] submitting...');
  const { data: s } = await axios.get(`https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&invisible=0&json=1`, { timeout: 30_000 });
  if (!s || s.status !== 1) throw new Error('2captcha submit: ' + s?.request);
  const id = s.request;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const { data: p } = await axios.get(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${id}&json=1`, { timeout: 15_000 });
    if (p?.status === 1) { console.log('[captcha] solved'); return p.request; }
    if (p?.request !== 'CAPCHA_NOT_READY') throw new Error('2captcha poll: ' + p?.request);
    process.stdout.write('.');
  }
  throw new Error('timeout');
}

(async () => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36');

  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await new Promise(r => setTimeout(r, 1000));
  await page.click('input[type="radio"][value="14"]');
  await new Promise(r => setTimeout(r, 2000));
  await page.click('input[type="radio"][value="47"]');
  await new Promise(r => setTimeout(r, 2000));

  const token = await solveCaptchaForPage(SEARCH_URL, TAS_SITE_KEY, process.env.CAPTCHA_API_KEY);
  await page.evaluate((t) => {
    const ta = document.getElementById('g-recaptcha-response');
    if (ta) ta.value = t;
    const ta2 = document.querySelector('textarea[name="g-recaptcha-response"]');
    if (ta2) ta2.value = t;
  }, token);

  // Search for 'Fairbrother' — a known TAS builder
  const bizId = 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_txtBusinessNameSearch';
  const inp = await page.$('#' + bizId);
  if (inp) { await inp.click({ clickCount: 3 }); await inp.type('Fairbrother', { delay: 50 }); }

  const submitId = 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_btnFilterMainGrid';
  const btn = await page.$('#' + submitId);
  if (btn) await btn.click();
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  const html = await page.content();
  const $ = cheerio.load(html);

  // Show all tables
  $('table').each((i, t) => {
    const headers = $(t).find('th').map((_, th) => $(th).text().trim()).get();
    const rows = $(t).find('tbody tr').length;
    const firstRow = $(t).find('tbody tr:first-child td').map((_, td) => $(td).text().trim()).get();
    const fullText = $(t).text().replace(/\s+/g, ' ').trim().slice(0, 300);
    if (fullText.length > 20) {
      console.log(`\nTable ${i}: headers=[${headers.join('|')}] bodyRows=${rows}`);
      if (firstRow.length) console.log('  First data row:', firstRow.join(' | '));
      else console.log('  Text:', fullText.slice(0, 200));
    }
  });

  await page.close();
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
