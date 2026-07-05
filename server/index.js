const express = require('express');
const cors = require('cors');
const { searchABN, searchByName } = require('./scrapers/abn');
const { searchAustLII } = require('./scrapers/austlii');
const { searchPaymentTimes } = require('./scrapers/paymentTimes');
const { searchModernSlavery } = require('./scrapers/modernSlavery');
const { searchQBCC } = require('./scrapers/qbcc');
const { searchASIC } = require('./scrapers/asic');
const { searchASICDisqualified } = require('./scrapers/asicDisqualified');
const { searchAsicInsolvency } = require('./scrapers/asicInsolvency');
const { searchAtoDebt } = require('./scrapers/atoDebt');
const { searchFWO } = require('./scrapers/fwo');
const { searchVicBpc } = require('./scrapers/vicBpc');
const { searchVicVbaLicence } = require('./scrapers/vicVbaLicence');
const { searchWABuildingEnergy } = require('./scrapers/waBuildingEnergy');
const { searchNSWFairTrading } = require('./scrapers/nswFairTrading');
const { searchNTBuildingPractitioners } = require('./scrapers/ntBuildingPractitioners');
const { searchACTLicences } = require('./scrapers/actLicences');
const { searchWALicenceRegister } = require('./scrapers/waLicenceRegister');
const { searchSALicenceRegister } = require('./scrapers/saLicenceRegister');
const { searchTASLicenceRegister } = require('./scrapers/tasLicenceRegister');
const { searchAsicExtract } = require('./scrapers/asicExtract');
const { searchAfsaNpii } = require('./scrapers/afsaNpii');
const { generateLinks } = require('./scrapers/links');

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/search/disambiguate', async (req, res) => {
  const { companyName } = req.body;
  if (!companyName) return res.status(400).json({ error: 'companyName is required', matches: [] });
  try {
    const matches = await searchByName(companyName);
    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: err.message, matches: [] });
  }
});

// Streaming search endpoint — sends results as they arrive
app.post('/api/search', async (req, res) => {
  const { abn, acn, companyName, tradingName, directors, isDeepCheck } = req.body;

  const hasDirectors = Array.isArray(directors) && directors.some(Boolean);
  if (!companyName && !abn && !hasDirectors) {
    return res.status(400).json({ error: 'Company name, ABN, or director name is required' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (result) => res.write(JSON.stringify(result) + '\n');

  // Shared promise so scrapers can wait for ASIC directors without a second HTTP call
  const asicPromise = searchASIC(companyName, abn, acn, process.env.CAPTCHA_API_KEY);

  // Returns the union of request-supplied directors and those discovered by ASIC.
  // Safe to call concurrently — all callers await the same promise.
  async function resolveDirectors() {
    const asicResult = await asicPromise;
    const asicDirectors = (asicResult.results ?? [])
      .filter((r) => r.metadata?.Role === 'Director')
      .map((r) => r.title)
      .filter(Boolean);
    return [...new Set([...(directors ?? []), ...asicDirectors])];
  }

  const searches = [
    { key: 'abn', label: 'ABR — Business Register', fn: () => searchABN(abn, companyName, acn) },
    {
      key: 'asic',
      label: 'ASIC Connect — Company Search',
      fn: () => asicPromise,
    },
    {
      key: 'asicDisqualified',
      label: 'ASIC — Disqualified Persons Register',
      fn: async () => searchASICDisqualified(await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'asicInsolvency',
      label: 'ASIC Published Notices — Insolvency',
      fn: () => searchAsicInsolvency(companyName, abn, acn),
    },
    {
      key: 'atoDebt',
      label: 'ASIC Published Notices — ATO Tax Debt',
      fn: () => searchAtoDebt(companyName, abn, acn),
    },
    {
      key: 'austlii_federal',
      label: 'Federal Courts (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'federal'),
    },
    {
      key: 'austlii_qld',
      label: 'QLD Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'qld'),
    },
    {
      key: 'austlii_nsw',
      label: 'NSW Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'nsw'),
    },
    {
      key: 'austlii_vic',
      label: 'VIC Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'vic'),
    },
    {
      key: 'austlii_wa',
      label: 'WA Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'wa'),
    },
    {
      key: 'austlii_sa',
      label: 'SA Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'sa'),
    },
    {
      key: 'austlii_nt',
      label: 'NT Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'nt'),
    },
    {
      key: 'austlii_act',
      label: 'ACT Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'act'),
    },
    {
      key: 'austlii_tas',
      label: 'TAS Courts & Tribunals (AustLII)',
      fn: async () => searchAustLII(companyName, await resolveDirectors(), 'tas'),
    },
    {
      key: 'paymentTimes',
      label: 'Payment Times Reporting Register',
      fn: () => searchPaymentTimes(companyName, abn, acn),
    },
    {
      key: 'modernSlavery',
      label: 'Modern Slavery Statements Register',
      fn: () => searchModernSlavery(companyName, abn),
    },
    {
      key: 'qbcc',
      label: 'QBCC — Licence Register',
      fn: async () => searchQBCC(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'fwo',
      label: 'Fair Work Ombudsman — Enforcement Outcomes',
      fn: async () => searchFWO(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'vicBpc',
      label: 'VIC Building Authority — Disciplinary Register',
      fn: async () => searchVicBpc(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'vicVbaLicence',
      label: 'VIC Building Authority — Licence Register',
      fn: async () => searchVicVbaLicence(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'waBuildingEnergy',
      label: 'WA Building and Energy — Enforcement',
      fn: async () => searchWABuildingEnergy(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'nswFairTrading',
      label: 'NSW Fair Trading — Contractor Licence Register',
      fn: async () => searchNSWFairTrading(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'ntBuildingPractitioners',
      label: 'NT Building Practitioners Board — Licence Register',
      fn: async () => searchNTBuildingPractitioners(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'actLicences',
      label: 'ACT Access Canberra — Builder Licence Register',
      fn: async () => searchACTLicences(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'waLicenceRegister',
      label: 'WA Building Services — Contractor Licence Register',
      fn: async () => searchWALicenceRegister(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'saLicenceRegister',
      label: 'SA Consumer & Business Services — Licence Register',
      fn: async () => searchSALicenceRegister(companyName, abn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'tasLicenceRegister',
      label: 'TAS Occupational Licensing — Licence Register',
      fn: async () => searchTASLicenceRegister(companyName, abn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'asicExtract',
      label: 'ASIC — Director Company History',
      fn: async () => searchAsicExtract(companyName, abn, acn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'links',
      label: 'Additional Database Links',
      fn: () => Promise.resolve(generateLinks({ abn, acn, companyName, tradingName, directors })),
    },
  ];

  // Deep check scrapers — only added when isDeepCheck: true
  if (isDeepCheck) {
    searches.push(
      {
        key: 'afsaNpii',
        label: 'AFSA NPII — Director Personal Insolvency (Deep Check)',
        fn: async () => searchAfsaNpii(await resolveDirectors()),
      }
    );
  }

  await Promise.all(
    searches.map(async ({ key, label, fn }) => {
      send({ key, label, status: 'searching' });
      try {
        const result = await fn();
        send({ key, label, status: 'done', ...result });
      } catch (err) {
        send({ key, label, status: 'error', error: err.message, results: [] });
      }
    })
  );

  res.end();
});

app.listen(PORT, () => console.log(`Know Your Builder server running on http://localhost:${PORT}`));
