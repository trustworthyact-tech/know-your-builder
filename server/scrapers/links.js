function generateLinks({ abn, acn, companyName }) {
  const q = encodeURIComponent(companyName || '');

  const links = [
    // ── Licences (→ 8.2) ─────────────────────────────────────────────────────
    {
      jurisdiction: 'NSW',
      category: 'license',
      source: 'NSW Fair Trading — Licence Check',
      url: `https://www.onlineservices.fairtrading.nsw.gov.au/ftsonline/licence/form.do?licence_action=SEARCH&q=${q}`,
      description: 'NSW contractor, building and trade licence verification',
    },
    {
      jurisdiction: 'VIC',
      category: 'license',
      source: 'Victorian Building Authority — Licence Check',
      url: `https://www.vba.vic.gov.au/check/licence?name=${q}`,
      description: 'VIC building practitioner registration and licence status',
    },
    {
      jurisdiction: 'WA',
      category: 'license',
      source: 'Building & Energy WA — Licence Check',
      url: `https://www.commerce.wa.gov.au/building-and-energy/licence-search?name=${q}`,
      description: 'WA building contractor and occupational licence verification',
    },
    {
      jurisdiction: 'SA',
      category: 'license',
      source: 'Consumer & Business Services SA — Licence Check',
      url: `https://www.cbs.sa.gov.au/licences/check-a-licence?q=${q}`,
      description: 'SA building work contractor licence verification',
    },
    {
      jurisdiction: 'NT',
      category: 'license',
      source: 'NT Building Practitioners Board — Licence Check',
      url: `https://buildinglicences.nt.gov.au/search?name=${q}`,
      description: 'NT building practitioner licence verification',
    },
    {
      jurisdiction: 'ACT',
      category: 'license',
      source: 'ACT Access Canberra — Licence Check',
      url: `https://www.accesscanberra.act.gov.au/licence-and-registration/check-a-licence?q=${q}`,
      description: 'ACT builder and contractor licence verification',
    },
    {
      jurisdiction: 'TAS',
      category: 'license',
      source: 'Consumer, Building & Occupational Services TAS — Licence Check',
      url: `https://www.cbos.tas.gov.au/topics/licensing/check-a-licence?q=${q}`,
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
