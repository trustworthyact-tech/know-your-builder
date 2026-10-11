// Run with `npm test` (tsx --test). Covers LICENCE_MATCHING_PLAN.md 3.3: name-only results never
// drive a finding, and records against a linked company raise a separate, lower-severity
// "associated company" trigger instead of counting as the searched entity's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskGrouper } from './riskGrouper';
import type { ResultItem, SearchResult } from '@/src/types';

const NAME_ONLY = 'Name only — verify';

function result(key: string, results: ResultItem[]): SearchResult {
  return { key, label: key, status: 'done', results };
}

function findings(...rs: SearchResult[]): Record<string, SearchResult> {
  return Object.fromEntries(rs.map((r) => [r.key, r]));
}

const court = (title: string, metadata?: Record<string, string>): ResultItem => ({ title, metadata });

test('name-only results drive no finding', () => {
  const groups = riskGrouper(
    findings(
      result('actDisciplinary', [{ title: 'KEGGINS', metadata: { MatchedBy: NAME_ONLY } }]),
      result('nswFairTrading', [{ title: 'X', metadata: { MatchedBy: NAME_ONLY, ComplianceHistory: 'Yes (1 recorded event(s))' } }]),
      result('courts_federal', [court('A v B', { MatchedBy: NAME_ONLY, FoundBySearching: 'Someone' })]),
      result('fwo', [court('FWO v X', { MatchedBy: NAME_ONLY })])
    )
  );
  assert.deepEqual(groups, []);
});

test('own results still drive findings as before', () => {
  const groups = riskGrouper(
    findings(
      result('actDisciplinary', [{ title: 'TURNKEY', metadata: { MatchedBy: 'ACN' } }]),
      result('courts_federal', [court('A v Turnkey', { FoundBySearching: 'TURNKEY CREATIONS' })])
    )
  );
  const ids = groups.map((g) => g.id).sort();
  assert.deepEqual(ids, ['LEGAL', 'LICENSING']);
  assert.equal(groups.find((g) => g.id === 'LEGAL')!.severity, 'significant');
});

test("a director's linked personal licence counts as the entity's own", () => {
  const groups = riskGrouper(
    findings(
      result('nswFairTrading', [
        { title: 'Constable', metadata: { MatchedBy: 'Linked on licence record', ComplianceHistory: 'Yes (2 recorded event(s))' } },
      ])
    )
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'LICENSING');
});

test('linked-company records raise one associated-company trigger, at findings severity, and nothing else', () => {
  const linked = { MatchedBy: 'Linked company — via Frank Walmsley', LinkedCompany: 'OLD BUILDS PTY LTD', LinkedVia: 'Frank Walmsley (Director)' };
  const groups = riskGrouper(
    findings(
      result('courts_federal', [court('Creditor v Old Builds', linked), court('Other v Old Builds', linked)]),
      result('fwo', [court('FWO v Old Builds', linked)]),
      result('nswFairTrading', [
        { title: 'OLD BUILDS PTY LTD', status: 'Cancelled', metadata: linked },
        { title: 'FINE BUILDS PTY LTD', status: 'Current', metadata: { ...linked, LinkedCompany: 'FINE BUILDS PTY LTD' } },
      ])
    )
  );
  assert.equal(groups.length, 1);
  const [corporate] = groups;
  assert.equal(corporate.id, 'CORPORATE');
  assert.equal(corporate.severity, 'findings');
  assert.deepEqual(
    corporate.triggers.map((t) => t.finding),
    [
      'Associated company OLD BUILDS PTY LTD (linked via Frank Walmsley (Director)): 2 court or tribunal decision(s), 1 Fair Work Ombudsman enforcement outcome(s), 1 cancelled or suspended licence(s)',
    ]
  );
});

test('a name-only linked company raises nothing', () => {
  const groups = riskGrouper(
    findings(result('courts_federal', [court('X v Maybe Co', { MatchedBy: NAME_ONLY, LinkedCompany: 'Maybe Co Pty Ltd' })]))
  );
  assert.deepEqual(groups, []);
});

test('associated-company triggers never lower an existing significant corporate finding', () => {
  const groups = riskGrouper(
    findings(
      result('asicEnforceableUndertakings', [{ title: 'Turnkey EU', metadata: { FoundBySearching: 'Turnkey Creations' } }]),
      result('fwo', [court('FWO v Old Builds', { MatchedBy: 'Linked company — via F', LinkedCompany: 'OLD BUILDS PTY LTD' })])
    )
  );
  const corporate = groups.find((g) => g.id === 'CORPORATE')!;
  assert.equal(corporate.severity, 'significant');
  assert.equal(corporate.triggers.length, 2);
});
