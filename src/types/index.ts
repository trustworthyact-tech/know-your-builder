export interface BuilderInput {
  abn: string;
  acn: string;
  companyName: string;
  tradingName: string;
  directors: string[];
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
export type Category = 'identity' | 'financial' | 'payment' | 'license' | 'legal' | 'regulatory' | 'links' | 'other';
export type Jurisdiction = 'Federal' | 'QLD' | 'NSW' | 'VIC' | 'WA' | 'SA' | 'NT' | 'ACT' | 'TAS' | 'All';

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
  searchUrl?: string;
  adjudicationSearchUrl?: string;
  summary?: string;
  error?: string;
  sources?: string[];
}

export type RootStackParamList = {
  Home: undefined;
  Searching: { input: BuilderInput };
  Report: { results: SearchResult[]; input: BuilderInput };
};
