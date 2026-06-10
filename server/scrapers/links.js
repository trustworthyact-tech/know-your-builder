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
      // Old domain (onlineservices.fairtrading.nsw.gov.au) is defunct; licence
      // search is now hosted on fairtrading.nsw.gov.au under licences-and-credentials.
      url: `https://www.fairtrading.nsw.gov.au/business-and-economy/licences-and-credentials`,
      description: 'NSW contractor, building and trade licence verification',
    },
    {
      jurisdiction: 'VIC',
      category: 'license',
      source: 'Victorian Building Authority — Licence Check',
      // Old path (/check/licence) returns 404; current practitioner search is
      // at /find-a-practitioner but requires JavaScript — direct link to that page.
      url: `https://www.vba.vic.gov.au/find-a-practitioner`,
      description: 'VIC building practitioner registration and licence status',
    },
    {
      jurisdiction: 'WA',
      category: 'license',
      source: 'Building & Energy WA — Licence Check',
      // commerce.wa.gov.au path now redirects to wa.gov.au licence search page.
      url: `https://www.wa.gov.au/organisation/building-and-energy/building-and-energy-licence-and-registration-search`,
      description: 'WA building contractor and occupational licence verification',
    },
    {
      jurisdiction: 'SA',
      category: 'license',
      source: 'Consumer & Business Services SA — Licence Check',
      // Old /licences/check-a-licence path is gone; CBS licence check now
      // requires JavaScript — link to the licensing landing page.
      url: `https://www.cbs.sa.gov.au/licensing`,
      description: 'SA building work contractor licence verification',
    },
    {
      jurisdiction: 'NT',
      category: 'license',
      source: 'NT Building Practitioners Board — Licence Check',
      // buildinglicences.nt.gov.au DNS no longer resolves (2026-06-11).
      // NT licence check now appears to be under nt.gov.au — link to info page.
      url: `https://nt.gov.au/property/building-and-construction`,
      description: 'NT building practitioner licence verification',
    },
    {
      jurisdiction: 'ACT',
      category: 'license',
      source: 'ACT Access Canberra — Licence Check',
      // Previous path was removed from Access Canberra (2026-06-11).
      // Licence check is now via the Access Canberra licences portal.
      url: `https://www.accesscanberra.act.gov.au/licences`,
      description: 'ACT builder and contractor licence verification',
    },
    {
      jurisdiction: 'TAS',
      category: 'license',
      source: 'Consumer, Building & Occupational Services TAS — Licence Check',
      // /topics/licensing/check-a-licence returns 404; OLAS portal
      // (olas.cbos.tas.gov.au) is the current licence lookup system.
      url: `https://www.cbos.tas.gov.au/topics/licensing`,
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
