'use strict';
require('dotenv').config();
const { getBrowser } = require('../scrapers/browser');

const SEARCH_URL = 'https://occupationallicensing.justice.tas.gov.au/Search/OnlineSearch.aspx';

(async () => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  try {
    console.log('Navigating to TAS search page...');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    console.log('Page title:', await page.title());
    console.log('URL:', page.url());

    // Check what radios are on the page
    const radios = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="radio"]')).map(r => ({
        value: r.value, id: r.id, name: r.name,
        label: document.querySelector('label[for="' + r.id + '"]')?.textContent?.trim(),
      }))
    );
    console.log('Radios:', JSON.stringify(radios.slice(0, 10), null, 2));

    // Check if there's a CAPTCHA
    const captchaKey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      return el ? el.getAttribute('data-sitekey') : null;
    });
    console.log('CAPTCHA sitekey:', captchaKey);

    // Is there a Building Services Provider radio?
    const bsp = radios.find(r => r.value === '14');
    console.log('BSP radio (value=14):', bsp);

    // Try clicking the BSP radio
    if (bsp) {
      await page.click('input[type="radio"][value="14"]').catch(e => console.log('BSP click error:', e.message));
      await new Promise(r => setTimeout(r, 2000));
      console.log('After BSP click, URL:', page.url());

      // What new radios appear?
      const newRadios = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="radio"]')).map(r => ({
          value: r.value, id: r.id, name: r.name,
          label: document.querySelector('label[for="' + r.id + '"]')?.textContent?.trim(),
          visible: window.getComputedStyle(r).display !== 'none',
        }))
      );
      console.log('Radios after BSP:', JSON.stringify(newRadios, null, 2));

      // Click Company radio (value=47)
      await page.click('input[type="radio"][value="47"]').catch(e => console.log('Company radio click error:', e.message));
      await new Promise(r => setTimeout(r, 2000));

      const captchaAfter47 = await page.evaluate(() => document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey'));
      console.log('CAPTCHA sitekey after Company click:', captchaAfter47);

      // What name inputs appeared?
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="text"], input[type="search"]')).map(i => ({
          id: i.id, name: i.name, value: i.value,
          visible: window.getComputedStyle(i).display !== 'none' && i.offsetParent !== null,
        }))
      );
      console.log('Text inputs after Company:', JSON.stringify(inputs, null, 2));

      // Fill the first visible text input
      const nameInput = inputs.find(i => i.visible && !i.id.includes('Recaptcha'));
      if (nameInput) {
        await page.type('#' + nameInput.id, 'Multiplex', { delay: 60 });
        console.log('Typed Multiplex into #' + nameInput.id);

        // Check for submit buttons
        const btns = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], input[type="button"]')).map(b => ({
            id: b.id, value: b.value || b.textContent?.trim(), type: b.type,
            visible: window.getComputedStyle(b).display !== 'none',
          }))
        );
        console.log('Submit buttons:', JSON.stringify(btns, null, 2));

        // Check for CAPTCHA before submitting
        const captchaBeforeSubmit = await page.evaluate(() => document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey'));
        console.log('CAPTCHA before submit:', captchaBeforeSubmit);
      }
    }

  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    await page.close();
    process.exit(0);
  }
})();
