function generateLinks({ abn, acn, companyName }) {
  const q = encodeURIComponent(companyName || '');

  const links = [
    // ── Licences (→ 8.2) ─────────────────────────────────────────────────────
    // URLs verified 2026-06-11 via probe tests (server/tests/test-*-licence.js).
    // These are landing/search pages for manual lookup — none support automated
    // deep-linking directly into results.
    {
      jurisdiction: 'NSW',
      category: 'license',
      source: 'NSW Fair Trading — Licence Check',
      // Old domain defunct. NSW migrated to OneGov SPA (onegov.nsw.gov.au/publicregister)
      // backed by a JSON API — fully scrapeable without Puppeteer. See test-nsw-fairtrading-licence.js.
      url: `https://www.onegov.nsw.gov.au/publicregister/`,
      description: 'NSW contractor, building and trade licence verification',
    },
    {
      jurisdiction: 'VIC',
      category: 'license',
      source: 'Victorian Building Authority — Licence Check',
      // Both /check/licence and /find-a-practitioner return 404.
      // The real search tool is a Salesforce Experience Cloud app at
      // bams.vba.vic.gov.au — linked from /tools/find-practitioner.
      // The BAMS app uses an Aura ApexAction API (PractitionerSearchUtil.getPractitioners)
      // and requires Puppeteer interaction (inputs are in LWC shadow DOM).
      url: `https://bams.vba.vic.gov.au/bams/s/practitioner-search`,
      description: 'VIC building practitioner registration and licence status',
    },
    {
      jurisdiction: 'WA',
      category: 'license',
      source: 'Building & Energy WA — Licence Check',
      // commerce.wa.gov.au and wa.gov.au both resolve to a CMS landing page.
      // Real register is ols.demirs.wa.gov.au — Angular SPA with a public REST API.
      url: `https://ols.demirs.wa.gov.au/search`,
      description: 'WA building contractor and occupational licence verification',
    },
    {
      jurisdiction: 'SA',
      category: 'license',
      source: 'Consumer & Business Services SA — Licence Check',
      // /licences/check-a-licence and /licensing are both 404. Real search portal
      // is secure.cbs.sa.gov.au/OccLicPubReg/ (reCAPTCHA v2 + Vue SPA).
      url: `https://www.cbs.sa.gov.au/find-a-licence-holder`,
      description: 'SA building work contractor licence verification',
    },
    {
      jurisdiction: 'NT',
      category: 'license',
      source: 'NT Building Practitioners Board — Licence Check',
      // buildinglicences.nt.gov.au DNS no longer resolves. Live register is
      // NTLIS (NT Land Information System) — plain HTML, no JS required.
      url: `https://www.ntlis.nt.gov.au/building-practitioners/`,
      description: 'NT building practitioner licence verification',
    },
    {
      jurisdiction: 'ACT',
      category: 'license',
      source: 'ACT Access Canberra — Licence Check',
      // accesscanberra.act.gov.au paths are all 404. ACT uses a Socrata open-data
      // API (data.act.gov.au/resource/de4w-gbt3.json) — 11k+ builder records, no auth/JS.
      url: `https://www.data.act.gov.au/Business-and-Industry/List-of-Professionals/de4w-gbt3`,
      description: 'ACT builder and contractor licence verification',
    },
    {
      jurisdiction: 'TAS',
      category: 'license',
      source: 'Consumer, Building & Occupational Services TAS — Licence Check',
      // cbos.tas.gov.au paths are gone. Live portal is occupationallicensing.justice.tas.gov.au —
      // ASP.NET WebForms, reCAPTCHA-protected. Link to the search page directly.
      url: `https://occupationallicensing.justice.tas.gov.au/Search/onlinesearch.aspx`,
      description: 'TAS building practitioner licence verification',
    },

    // ── Fair Work Commission (→ 8.3) ─────────────────────────────────────────
    {
      jurisdiction: 'Federal',
      category: 'fwc',
      source: 'Fair Work Commission',
      url: `https://www.fwc.gov.au/search?keys=${q}`,
      description: 'Industrial disputes, unfair dismissal, enterprise agreements',
    },

    // ── Enforcement (→ 8.5) ──────────────────────────────────────────────────
    {
      jurisdiction: 'Federal',
      category: 'regulatory',
      source: 'Federal Court — eLodgment Search',
      url: `https://www.fedcourt.gov.au/online-services/search-for-a-case`,
      description: 'Federal Court proceedings (requires name search on site)',
    },
    {
      jurisdiction: 'Federal',
      category: 'regulatory',
      source: 'Workplace Gender Equality Agency (WGEA)',
      url: `https://www.wgea.gov.au/data-statistics/data-explorer?q=${q}`,
      description: 'Gender equality reporting data for relevant employers',
    },
    {
      jurisdiction: 'QLD',
      category: 'regulatory',
      source: 'Office of Industrial Relations QLD',
      url: `https://www.worksafe.qld.gov.au/search#q=${q}&t=All`,
      description: 'Workplace health and safety incidents, prosecutions, enforceable undertakings',
    },
    {
      jurisdiction: 'QLD',
      category: 'regulatory',
      source: 'Queensland Office of Fair Trading',
      url: `https://www.fairtrading.qld.gov.au/search#q=${q}`,
      description: 'Fair trading complaints, licence actions, alerts',
    },
    {
      jurisdiction: 'NSW',
      category: 'regulatory',
      source: 'SafeWork NSW',
      url: `https://www.safework.nsw.gov.au/search#q=${q}`,
      description: 'WHS prosecutions and enforceable undertakings',
    },
    {
      jurisdiction: 'VIC',
      category: 'regulatory',
      source: 'WorkSafe Victoria',
      url: `https://www.worksafe.vic.gov.au/search#q=${q}`,
      description: 'WHS prosecutions and enforceable undertakings',
    },
  ];

  return {
    source: 'Additional Database Links',
    jurisdiction: 'All',
    category: 'links',
    results: links.map((l) => ({
      title: l.source,
      url: l.url,
      description: l.description,
      jurisdiction: l.jurisdiction,
      category: l.category,
    })),
    searchUrl: '',
    summary: `${links.length} additional databases for manual review`,
  };
}

module.exports = { generateLinks };
