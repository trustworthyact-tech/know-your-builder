export interface BuilderInput {
  abn: string;
  acn: string;
  companyName: string;
  tradingName: string;
  directors: string[];
  directorName?: string;
}

export interface ResultItem {
  title: string;
  url?: string;
  description?: string;
  date?: string;
  status?: string;
  metadata?: Record<string, string>;
  jurisdiction?: string;
  category?: string;
  matchedTerm?: string;
  isAdjudication?: boolean;
}

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';
export type Category = 'identity' | 'financial' | 'payment' | 'license' | 'legal' | 'regulatory' | 'other';
export type Jurisdiction = 'Federal' | 'QLD' | 'NSW' | 'VIC' | 'WA' | 'SA' | 'NT' | 'ACT' | 'TAS' | 'All';

// WS0.2 (reliability plan) — additive completeness metadata. Not yet consumed by
// riskGrouper/ReportContent; wiring these into the UI is WS0.5, a separate pass.
export type Completeness = 'complete' | 'partial' | 'stale' | 'unavailable';
export type DataSource = 'live' | 'cache' | 'manual';

export interface SearchResult {
  key: string;
  label: string;
  status: SearchStatus;
  source?: string;
  jurisdiction?: Jurisdiction;
  category?: Category;
  results?: ResultItem[];
  licenceResults?: ResultItem[];
  adjudicationResults?: ResultItem[];
  enforcementResults?: ResultItem[];
  searchUrl?: string;
  adjudicationSearchUrl?: string;
  acatSearchUrl?: string;
  summary?: string;
  error?: string;
  sources?: string[];
  completeness?: Completeness;
  dataSource?: DataSource;
  asOf?: string;
}

export enum Persona {
  HOMEOWNER = 'HOMEOWNER',
  SUBCONTRACTOR = 'SUBCONTRACTOR',
  DEVELOPER = 'DEVELOPER',
  LENDER = 'LENDER',
}

export type RiskGroupId = 'INSOLVENCY' | 'PAYMENT' | 'LICENSING' | 'LEGAL' | 'CORPORATE';

export interface RiskGroupTrigger {
  scraperKey: string;
  finding: string;
  anchor: string;
}

export interface RiskGroupResult {
  id: RiskGroupId;
  label: string;
  description: string;
  severity: 'significant' | 'findings';
  triggers: RiskGroupTrigger[];
}
