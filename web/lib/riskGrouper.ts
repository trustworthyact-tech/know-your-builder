import { SearchResult, RiskGroupResult, RiskGroupId, RiskGroupTrigger, ResultItem } from '@/src/types';

const LABELS: Record<RiskGroupId, string> = {
  INSOLVENCY: 'Insolvency & Financial Distress',
  PAYMENT: 'Late Payment & Subcontractor Disputes',
  LICENSING: 'Licensing & Regulatory Standing',
  LEGAL: 'Legal Proceedings & Dispute History',
  CORPORATE: 'Corporate Structure & Phoenix Risk',
};

const DESCRIPTIONS: Record<RiskGroupId, string> = {
  INSOLVENCY:
    'These results suggest the builder may be under financial stress or at risk of insolvency. A builder that enters administration mid-project typically leaves clients with unfinished work, progress payments lost, and a lengthy process to access home warranty cover. This risk is relevant regardless of project stage.',
  PAYMENT:
    'These results indicate the builder has a history of late or disputed payments to subcontractors, suppliers, or workers. For homeowners, unpaid subcontractors can lodge charges directly against the property. For subcontractors and suppliers, these are direct indicators of payment risk on this engagement.',
  LICENSING:
    'These results indicate the builder may not hold the required licence for the contracted work, or has been subject to regulatory enforcement. In most states, an unlicensed contractor cannot legally take a deposit, and work performed without the correct licence may void home warranty insurance and complicate any defect claims.',
  LEGAL:
    'These results show the builder has been named in court or tribunal proceedings. Isolated proceedings are not unusual in the construction industry. Multiple or recent matters — particularly in superior courts, or involving regulatory bodies — suggest a pattern of dispute that warrants closer scrutiny.',
  CORPORATE:
    "These results raise questions about the builder's corporate structure. Phoenix activity — where directors move assets from a failing company to a new entity to avoid paying creditors — is a known risk in the Australian construction industry. These signals do not confirm phoenixing but indicate a structure that warrants closer scrutiny of trading history before committing.",
};

const INACTIVE_STATUSES = ['expired', 'suspended', 'cancelled', 'inactive', 'lapsed'];

function resultsOf(findings: Record<string, SearchResult>, key: string): ResultItem[] {
  return findings[key]?.results ?? [];
}

function extractYear(text: string): number | null {
  const match = text.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function resultIsWithinYears(item: ResultItem, years: number): boolean {
  const cutoff = new Date().getFullYear() - years;
  const sources = [item.url ?? '', item.title ?? '', item.description ?? ''];
  return sources.some((s) => {
    const year = extractYear(s);
    return year !== null && year > cutoff;
  });
}

function isRegisteredWithinYears(dateStr: string, years: number): boolean {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    return d > cutoff;
  } catch {
    return false;
  }
}

function hasInactiveStatus(item: ResultItem): boolean {
  const status = (item.status ?? item.metadata?.['Status'] ?? '').toLowerCase();
  return INACTIVE_STATUSES.some((s) => status.includes(s));
}

export function riskGrouper(findings: Record<string, SearchResult>): RiskGroupResult[] {
  const groups: RiskGroupResult[] = [];

  // ── INSOLVENCY ─────────────────────────────────────────────────────────────
  {
    const triggers: RiskGroupTrigger[] = [];
    let severity: 'significant' | 'findings' = 'findings';

    const asicInsolvency = resultsOf(findings, 'asicInsolvency');
    if (asicInsolvency.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'asicInsolvency',
        finding: `${asicInsolvency.length} ASIC insolvency notice(s) found`,
        anchor: '#s83',
      });
    }

    const atoDebt = resultsOf(findings, 'atoDebt');
    if (atoDebt.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'atoDebt',
        finding: `${atoDebt.length} ATO tax debt disclosure(s) found`,
        anchor: '#s83',
      });
    }

    const afsaNpii = resultsOf(findings, 'afsaNpii');
    if (afsaNpii.length > 0) {
      triggers.push({
        scraperKey: 'afsaNpii',
        finding: `${afsaNpii.length} director personal insolvency record(s) (deep check)`,
        anchor: '#s81',
      });
    }

    // asicExtract: 2+ related entities deregistered (deep check)
    const asicExtractResults = resultsOf(findings, 'asicExtract');
    const deregisteredCount = asicExtractResults.filter(
      (r) =>
        r.status?.toLowerCase().includes('deregistered') ||
        r.status?.toLowerCase().includes('cancelled')
    ).length;
    if (deregisteredCount >= 2) {
      triggers.push({
        scraperKey: 'asicExtract',
        finding: `${deregisteredCount} related entities deregistered in recent years (deep check)`,
        anchor: '#s81',
      });
    }

    // abn contextual modifier — only when at least one other trigger exists
    if (triggers.length > 0) {
      const abnDate = resultsOf(findings, 'abn')[0]?.date ?? '';
      if (abnDate && isRegisteredWithinYears(abnDate, 2)) {
        triggers.push({
          scraperKey: 'abn',
          finding: 'Entity registered within the past 2 years — short trading history increases financial risk',
          anchor: '#s81',
        });
      }
    }

    if (triggers.length > 0) {
      groups.push({
        id: 'INSOLVENCY',
        label: LABELS.INSOLVENCY,
        description: DESCRIPTIONS.INSOLVENCY,
        severity,
        triggers,
      });
    }
  }

  // ── PAYMENT ───────────────────────────────────────────────────────────────
  {
    const triggers: RiskGroupTrigger[] = [];
    let severity: 'significant' | 'findings' = 'findings';

    const qbcc = findings['qbcc'];
    const adjudicationResults = qbcc?.adjudicationResults ?? [];
    if (adjudicationResults.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'qbcc',
        finding: `${adjudicationResults.length} QBCC adjudication decision(s) found`,
        anchor: '#s84',
      });
    }

    // Security of Payment keywords across all AustLII jurisdictions
    const austliiKeys = Object.keys(findings).filter((k) => k.startsWith('austlii_'));
    const sopResults = austliiKeys.flatMap((k) =>
      (findings[k]?.results ?? []).filter(
        (r) =>
          r.title?.toLowerCase().includes('security of payment') ||
          r.description?.toLowerCase().includes('security of payment') ||
          r.title?.toLowerCase().includes('bcisopa') ||
          r.description?.toLowerCase().includes('bcisopa') ||
          r.title?.toLowerCase().includes('bif act') ||
          r.description?.toLowerCase().includes('bif act')
      )
    );
    if (sopResults.length > 0) {
      triggers.push({
        scraperKey: 'austlii',
        finding: `${sopResults.length} Security of Payment enforcement decision(s) found in court records`,
        anchor: '#s85',
      });
    }

    const fwo = resultsOf(findings, 'fwo');
    if (fwo.length > 0) {
      triggers.push({
        scraperKey: 'fwo',
        finding: `${fwo.length} Fair Work Ombudsman enforcement outcome(s) found`,
        anchor: '#s85',
      });
    }

    const paymentTimes = resultsOf(findings, 'paymentTimes');
    if (paymentTimes.length > 0) {
      triggers.push({
        scraperKey: 'paymentTimes',
        finding: 'Entity appears on the Payment Times Reporting Register — review payment performance data',
        anchor: '#s83',
      });
    }

    if (triggers.length > 0) {
      groups.push({
        id: 'PAYMENT',
        label: LABELS.PAYMENT,
        description: DESCRIPTIONS.PAYMENT,
        severity,
        triggers,
      });
    }
  }

  // ── LICENSING ─────────────────────────────────────────────────────────────
  {
    const triggers: RiskGroupTrigger[] = [];
    let severity: 'significant' | 'findings' = 'findings';

    const qbcc = findings['qbcc'];
    const licenceResults = qbcc?.licenceResults ?? [];

    if (qbcc?.status === 'done' && licenceResults.length > 0) {
      const inactiveLicences = licenceResults.filter(hasInactiveStatus);
      if (inactiveLicences.length > 0) {
        severity = 'significant';
        triggers.push({
          scraperKey: 'qbcc',
          finding: `${inactiveLicences.length} licence(s) with expired, suspended, or cancelled status`,
          anchor: '#s82',
        });
      }
    }

    const vicBpc = resultsOf(findings, 'vicBpc');
    if (vicBpc.length > 0) {
      triggers.push({
        scraperKey: 'vicBpc',
        finding: `${vicBpc.length} VIC Building and Plumbing Commission enforcement action(s) found`,
        anchor: '#s85',
      });
    }

    const waBuildingEnergy = resultsOf(findings, 'waBuildingEnergy');
    if (waBuildingEnergy.length > 0) {
      triggers.push({
        scraperKey: 'waBuildingEnergy',
        finding: `${waBuildingEnergy.length} WA Building and Energy enforcement action(s) found`,
        anchor: '#s85',
      });
    }

    const asicDisqualified = resultsOf(findings, 'asicDisqualified');
    if (asicDisqualified.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'asicDisqualified',
        finding: `${asicDisqualified.length} director(s) found on the ASIC disqualified persons register`,
        anchor: '#s81',
      });
    }

    if (triggers.length > 0) {
      groups.push({
        id: 'LICENSING',
        label: LABELS.LICENSING,
        description: DESCRIPTIONS.LICENSING,
        severity,
        triggers,
      });
    }
  }

  // ── LEGAL ─────────────────────────────────────────────────────────────────
  {
    const triggers: RiskGroupTrigger[] = [];
    let severity: 'significant' | 'findings' = 'findings';

    const austliiKeys = Object.keys(findings).filter((k) => k.startsWith('austlii_'));
    const allCourtResults = austliiKeys.flatMap((k) => findings[k]?.results ?? []);
    const totalCourtHits = allCourtResults.length;

    if (totalCourtHits >= 6) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'austlii',
        finding: `${totalCourtHits} court and tribunal decisions found across all jurisdictions`,
        anchor: '#s85',
      });
    } else if (totalCourtHits >= 3) {
      triggers.push({
        scraperKey: 'austlii',
        finding: `${totalCourtHits} court and tribunal decisions found across all jurisdictions`,
        anchor: '#s85',
      });
    }

    const federalResults = findings['austlii_federal']?.results ?? [];
    if (federalResults.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'austlii_federal',
        finding: `${federalResults.length} Federal Court or Federal Circuit Court decision(s) found`,
        anchor: '#s85',
      });
    }

    // Recent decisions (within 2 years) — only fire when total < 3 to avoid repetition
    if (totalCourtHits < 3) {
      const recentResults = allCourtResults.filter((r) => resultIsWithinYears(r, 2));
      if (recentResults.length > 0) {
        triggers.push({
          scraperKey: 'austlii',
          finding: `${recentResults.length} decision(s) found within the past 2 years`,
          anchor: '#s85',
        });
      }
    }

    if (triggers.length > 0) {
      groups.push({
        id: 'LEGAL',
        label: LABELS.LEGAL,
        description: DESCRIPTIONS.LEGAL,
        severity,
        triggers,
      });
    }
  }

  // ── CORPORATE ─────────────────────────────────────────────────────────────
  {
    const triggers: RiskGroupTrigger[] = [];
    let severity: 'significant' | 'findings' = 'findings';

    const asicResults = resultsOf(findings, 'asic');
    const inactiveAsic = asicResults.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status.length > 0 && !status.includes('active') && !status.includes('registered');
    });
    if (inactiveAsic.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'asic',
        finding: `Company status is "${inactiveAsic[0].status}" — not Active or Registered`,
        anchor: '#s81',
      });
    }

    const asicDisqualified = resultsOf(findings, 'asicDisqualified');
    if (asicDisqualified.length > 0) {
      severity = 'significant';
      triggers.push({
        scraperKey: 'asicDisqualified',
        finding: `${asicDisqualified.length} current director(s) found on the ASIC disqualified persons register`,
        anchor: '#s81',
      });
    }

    // asicExtract deep check: director associated with 2+ deregistered companies
    const asicExtractResults = resultsOf(findings, 'asicExtract');
    const deregisteredByDirector = asicExtractResults.filter(
      (r) =>
        r.status?.toLowerCase().includes('deregistered') ||
        r.status?.toLowerCase().includes('cancelled')
    );
    if (deregisteredByDirector.length >= 2) {
      triggers.push({
        scraperKey: 'asicExtract',
        finding: `Director(s) associated with ${deregisteredByDirector.length} subsequently deregistered companies (deep check)`,
        anchor: '#s81',
      });
    }

    if (triggers.length > 0) {
      groups.push({
        id: 'CORPORATE',
        label: LABELS.CORPORATE,
        description: DESCRIPTIONS.CORPORATE,
        severity,
        triggers,
      });
    }
  }

  // Significant findings first
  return groups.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'significant' ? -1 : 1
  );
}
