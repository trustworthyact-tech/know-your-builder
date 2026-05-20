const express = require('express');
const cors = require('cors');
const { searchABN, searchByName } = require('./scrapers/abn');
const { searchAustLII } = require('./scrapers/austlii');
const { searchPaymentTimes } = require('./scrapers/paymentTimes');
const { searchModernSlavery } = require('./scrapers/modernSlavery');
const { searchQBCC } = require('./scrapers/qbcc');
const { searchASIC } = require('./scrapers/asic');
const { searchASICDisqualified } = require('./scrapers/asicDisqualified');
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
  const { abn, acn, companyName, tradingName, directors } = req.body;

  if (!companyName && !abn) {
    return res.status(400).json({ error: 'Company name or ABN is required' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (result) => res.write(JSON.stringify(result) + '\n');

  // Shared promise so asicDisqualified can wait for ASIC directors without a second HTTP call
  const asicPromise = searchASIC(companyName, abn, acn);

  const searches = [
    { key: 'abn', label: 'ABR — Business Register', fn: () => searchABN(abn, companyName) },
    {
      key: 'asic',
      label: 'ASIC Connect — Company Search',
      fn: () => asicPromise,
    },
    {
      key: 'asicDisqualified',
      label: 'ASIC — Disqualified Persons Register',
      fn: async () => {
        const asicResult = await asicPromise;
        const asicDirectors = (asicResult.results ?? [])
          .filter((r) => r.metadata?.Role === 'Director')
          .map((r) => r.title)
          .filter(Boolean);
        const allDirectors = [...new Set([...(directors ?? []), ...asicDirectors])];
        return searchASICDisqualified(allDirectors);
      },
    },
    {
      key: 'austlii_federal',
      label: 'Federal Courts (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'federal'),
    },
    {
      key: 'austlii_qld',
      label: 'QLD Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'qld'),
    },
    {
      key: 'austlii_nsw',
      label: 'NSW Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'nsw'),
    },
    {
      key: 'austlii_vic',
      label: 'VIC Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'vic'),
    },
    {
      key: 'austlii_wa',
      label: 'WA Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'wa'),
    },
    {
      key: 'austlii_sa',
      label: 'SA Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'sa'),
    },
    {
      key: 'austlii_nt',
      label: 'NT Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'nt'),
    },
    {
      key: 'austlii_act',
      label: 'ACT Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'act'),
    },
    {
      key: 'austlii_tas',
      label: 'TAS Courts & Tribunals (AustLII)',
      fn: () => searchAustLII(companyName, directors, 'tas'),
    },
    {
      key: 'paymentTimes',
      label: 'Payment Times Reporting Register',
      fn: () => searchPaymentTimes(companyName, abn),
    },
    {
      key: 'modernSlavery',
      label: 'Modern Slavery Statements Register',
      fn: () => searchModernSlavery(companyName, abn),
    },
    { key: 'qbcc', label: 'QBCC — Licence Register', fn: () => searchQBCC(companyName, abn) },
    {
      key: 'links',
      label: 'Additional Database Links',
      fn: () => Promise.resolve(generateLinks({ abn, acn, companyName, tradingName, directors })),
    },
  ];

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
