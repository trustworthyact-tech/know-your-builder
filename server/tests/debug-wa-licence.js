'use strict';
require('dotenv').config();
const { getBrowser } = require('../scrapers/browser');

(async () => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
  await page.setRequestInterception(true);
  let apiCalls = [];
  page.on('response', async (res) => {
    try { if (res.url().includes('/api/')) apiCalls.push({ url: res.url(), status: res.status() }); } catch(e) {}
  });
  page.on('request', req => req.continue().catch(() => {}));

  await page.goto('https://ols.demirs.wa.gov.au', { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 1500));

  // Select 'Type' mode
  await page.evaluate(() => document.querySelector('mat-select').click());
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    for (const o of document.querySelectorAll('mat-option')) {
      if (o.textContent.trim() === 'Type') { o.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  // Type 'Building' into the autocomplete using page.type
  await page.click('input[aria-label="Licence type"]');
  await page.type('input[aria-label="Licence type"]', 'Building', { delay: 80 });
  await new Promise(r => setTimeout(r, 1500));

  const opts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mat-option')).map(o => o.textContent.trim())
  );
  console.log('autocomplete options:', opts.join(' | '));

  const hasBc = opts.some(o => o.includes('Building Contractor'));
  if (!hasBc) {
    console.log('Building Contractor option not found. Exiting.');
    await page.close();
    process.exit(0);
  }

  // Click Building Contractor
  await page.evaluate(() => {
    for (const o of document.querySelectorAll('mat-option')) {
      if (o.textContent.includes('Building Contractor')) { o.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  // What inputs appear after BC is selected?
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      id: i.id,
      label: i.getAttribute('aria-label'),
      placeholder: i.placeholder,
    }))
  );
  console.log('fields after BC selected:', JSON.stringify(fields, null, 2));

  // Inspect mat-form-field structure to find the name field label
  const formFields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mat-form-field')).map(f => ({
      label: f.querySelector('label,mat-label')?.textContent?.trim(),
      inputId: f.querySelector('input')?.id,
    }))
  );
  console.log('form fields after BC:', JSON.stringify(formFields, null, 2));

  // #mat-input-2 should be the name field — use it directly
  const nameInputId = 'mat-input-2';
  await page.click('#' + nameInputId);
  await page.type('#' + nameInputId, 'Multiplex', { delay: 60 });
  console.log('typed Multiplex into #' + nameInputId);
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('Search')) { console.log && console.log('clicking', b.textContent.trim()); b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 8000));

  // Also capture the response body
  const searchBody = await page.evaluate(async () => {
    const url = '/api/Search/licence/licenceType?LicenceType=BC&FirstName=&FamilyNameOrBusinessName=Multiplex&LocationOrPostCode=&SearchAll=false&PagingParameters.PageIndex=0&PagingParameters.PageSize=20';
    const res = await fetch(url);
    return await res.text();
  });
  console.log('search result body:', searchBody.slice(0, 800));

  await page.close();
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
