function generateLinks({ abn, acn, companyName, tradingName, directors = [] }) {
  const q = encodeURIComponent(companyName || '');
  const cleanAbn = (abn || '').replace(/\s/g, '');
  const cleanAcn = (acn || '').replace(/\s/g, '');

  const directorLinks = (directors || [])
    .filter(Boolean)
    .map((d) => encodeURIComponent(d));

  const links = [
    // ── Federal ──────────────────────────────────────────────────────────────
    {
      jurisdiction: 'Federal',
      category: 'identity',
      source: 'ASIC — Company Search',
      url: cleanAcn
        ? `https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx?_adf.ctrl-state=v9aypxjdm_4&searchType=OrgAndBusNm&searchText=${cleanAcn}`
        : `https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=OrgAndBusNm&searchText=${q}`,
      description: 'Company registration, directors, officeholders, charges & notices',
    },
    {
      jurisdiction: 'Federal',
      category: 'regulatory',
      source: 'ASIC Published Notices — Winding Up Applications',
      url: `https://publishednotices.asic.gov.au/browsesearch-notices?appointment=All&noticestate=All&companynameoracn=${cleanAbn.length === 11 ? cleanAbn.slice(2) : cleanAbn || q}`,
      description: 'Winding-up applications and other court-ordered proceedings',
    },
    {
      jurisdiction: 'Federal',
      category: 'regulatory',
      source: 'ASIC — Insolvency & Administration Notices',
      url: `https://publishednotices.asic.gov.au/browsesearch-notices?appointment=All&noticestate=All&companynameoracn=${cleanAbn.length === 11 ? cleanAbn.slice(2) : cleanAbn || q}`,
      description: 'Liquidator and administrator notices published after insolvency appointment',
    },
    {
      jurisdiction: 'Federal',
      category: 'regulatory',
      source: 'Workplace Gender Equality Agency (WGEA)',
      url: `https://www.wgea.gov.au/data-statistics/data-explorer?q=${q}`,
      description: 'Gender equality reporting data for relevant employers',
    },
    {
      jurisdiction: 'Federal',
      category: 'legal',
      source: 'Fair Work Commission',
      url: `https://www.fwc.gov.au/search?keys=${q}`,
      description: 'Industrial disputes, unfair dismissal, enterprise agreements',
    },
    {
      jurisdiction: 'Federal',
      category: 'legal',
      source: 'Federal Court — eLodgment Search',
      url: `https://www.fedcourt.gov.au/online-services/search-for-a-case`,
      description: 'Federal Court proceedings (requires name search on site)',
    },

    // ── QLD ──────────────────────────────────────────────────────────────────
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
      jurisdiction: 'QLD',
      category: 'legal',
      source: 'QBCC Adjudication Decisions',
      url: 'https://www.qbcc.qld.gov.au/adjudication-decisions',
      description: 'Adjudication decisions under the Building Industry Fairness Act',
    },
    {
      jurisdiction: 'QLD',
      category: 'legal',
      source: 'Queensland Civil & Administrative Tribunal (QCAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fqld%2FQCAT&results=20`,
      description: 'QCAT decisions (AustLII)',
    },
    {
      jurisdiction: 'QLD',
      category: 'legal',
      source: 'QLD Planning & Environment Court',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fqld%2FQLPEC&results=20`,
      description: 'Planning & environment decisions (AustLII)',
    },
    {
      jurisdiction: 'QLD',
      category: 'license',
      source: 'QBCC — Licence Register',
      url: `https://www.qbcc.qld.gov.au/find-a-local-contractor?name=${q}`,
      description: 'Queensland building licence details, class, financial category',
    },

    // ── NSW ──────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'NSW',
      category: 'license',
      source: 'NSW Fair Trading — Licence Check',
      url: `https://www.onlineservices.fairtrading.nsw.gov.au/ftsonline/licence/form.do?licence_action=SEARCH&q=${q}`,
      description: 'NSW contractor, building and trade licence verification',
    },
    {
      jurisdiction: 'NSW',
      category: 'legal',
      source: 'NSW Civil & Administrative Tribunal (NCAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fnsw%2FNSWCATAP%2C%2Fau%2Fcases%2Fnsw%2FNSWCAT&results=20`,
      description: 'NCAT decisions (AustLII)',
    },
    {
      jurisdiction: 'NSW',
      category: 'legal',
      source: 'NSW Land & Environment Court',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fnsw%2FNSWLEC&results=20`,
      description: 'Land & environment decisions (AustLII)',
    },
    {
      jurisdiction: 'NSW',
      category: 'regulatory',
      source: 'SafeWork NSW',
      url: `https://www.safework.nsw.gov.au/search#q=${q}`,
      description: 'WHS prosecutions and enforceable undertakings',
    },

    // ── VIC ──────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'VIC',
      category: 'license',
      source: 'Victorian Building Authority — Licence Check',
      url: `https://www.vba.vic.gov.au/check/licence?name=${q}`,
      description: 'VIC building practitioner registration and licence status',
    },
    {
      jurisdiction: 'VIC',
      category: 'regulatory',
      source: 'VBA — Prosecution & Disciplinary Register',
      url: 'https://www.vba.vic.gov.au/tools/prosecution-and-disciplinary-register',
      description: 'Completed disciplinary orders, disqualifications and prosecutions by the VBA',
    },
    {
      jurisdiction: 'VIC',
      category: 'legal',
      source: 'Victorian Civil & Administrative Tribunal (VCAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fvic%2FVCAT&results=20`,
      description: 'VCAT decisions (AustLII)',
    },
    {
      jurisdiction: 'VIC',
      category: 'regulatory',
      source: 'WorkSafe Victoria',
      url: `https://www.worksafe.vic.gov.au/search#q=${q}`,
      description: 'WHS prosecutions and enforceable undertakings',
    },

    // ── WA ───────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'WA',
      category: 'license',
      source: 'Building & Energy WA — Licence Check',
      url: `https://www.commerce.wa.gov.au/building-and-energy/licence-search?name=${q}`,
      description: 'WA building contractor and occupational licence verification',
    },
    {
      jurisdiction: 'WA',
      category: 'legal',
      source: 'WA State Administrative Tribunal (SAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fwa%2FWASAT&results=20`,
      description: 'SAT decisions (AustLII)',
    },
    {
      jurisdiction: 'WA',
      category: 'legal',
      source: 'WA Industrial Relations Commission',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fwa%2FWAIRC&results=20`,
      description: 'WA Industrial Relations Commission decisions (AustLII)',
    },

    // ── SA ───────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'SA',
      category: 'license',
      source: 'Consumer & Business Services SA — Licence Check',
      url: `https://www.cbs.sa.gov.au/licences/check-a-licence?q=${q}`,
      description: 'SA building work contractor licence verification',
    },
    {
      jurisdiction: 'SA',
      category: 'legal',
      source: 'SA Employment Tribunal (SAET)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fsa%2FSAET&results=20`,
      description: 'SAET decisions (AustLII)',
    },
    {
      jurisdiction: 'SA',
      category: 'legal',
      source: 'SA Environment Resources & Development Court',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fsa%2FSAERDC&results=20`,
      description: 'ERD Court decisions (AustLII)',
    },

    // ── NT ───────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'NT',
      category: 'license',
      source: 'NT Building Practitioners Board — Licence Check',
      url: `https://buildinglicences.nt.gov.au/search?name=${q}`,
      description: 'NT building practitioner licence verification',
    },
    {
      jurisdiction: 'NT',
      category: 'legal',
      source: 'NT Civil & Administrative Tribunal (NTCAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fnt%2FNTCAT&results=20`,
      description: 'NTCAT decisions (AustLII)',
    },

    // ── ACT ──────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'ACT',
      category: 'license',
      source: 'ACT Access Canberra — Licence Check',
      url: `https://www.accesscanberra.act.gov.au/licence-and-registration/check-a-licence?q=${q}`,
      description: 'ACT builder and contractor licence verification',
    },
    {
      jurisdiction: 'ACT',
      category: 'legal',
      source: 'ACT Civil & Administrative Tribunal (ACAT)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Fact%2FACAT&results=20`,
      description: 'ACAT decisions (AustLII)',
    },

    // ── TAS ──────────────────────────────────────────────────────────────────
    {
      jurisdiction: 'TAS',
      category: 'license',
      source: 'Consumer, Building & Occupational Services TAS — Licence Check',
      url: `https://www.cbos.tas.gov.au/topics/licensing/check-a-licence?q=${q}`,
      description: 'TAS building practitioner licence verification',
    },
    {
      jurisdiction: 'TAS',
      category: 'legal',
      source: 'TAS Supreme Court (AustLII)',
      url: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName || ''}"`)}&mask_path=%2Fau%2Fcases%2Ftas%2FTASSC&results=20`,
      description: 'TAS Supreme Court decisions (AustLII)',
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
    summary: `${links.length} additional databases ready for manual review`,
  };
}

module.exports = { generateLinks };
