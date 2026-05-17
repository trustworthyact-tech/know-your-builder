import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Share,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { ReportSection } from '../components/ReportSection';
import { RootStackParamList, SearchResult } from '../types';
import { colors, typography, shadows } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Report'>;
  route: RouteProp<RootStackParamList, 'Report'>;
};

function byKey(results: SearchResult[], ...keys: string[]): SearchResult[] {
  return results.filter((r) => keys.includes(r.key));
}

function totalResults(results: SearchResult[]): number {
  return results.reduce((n, r) => n + (r.results?.length ?? 0), 0);
}

export function ReportScreen({ navigation, route }: Props) {
  const { results, input } = route.params;
  const now = new Date().toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const identity = byKey(results, 'abn');
  const payment = byKey(results, 'paymentTimes');
  const modernSlavery = byKey(results, 'modernSlavery');
  const licences = byKey(results, 'qbcc');
  const federal = byKey(results, 'austlii_federal');
  const qld = byKey(results, 'austlii_qld');
  const nsw = byKey(results, 'austlii_nsw');
  const vic = byKey(results, 'austlii_vic');
  const wa = byKey(results, 'austlii_wa');
  const sa = byKey(results, 'austlii_sa');
  const nt = byKey(results, 'austlii_nt');
  const act = byKey(results, 'austlii_act');
  const tas = byKey(results, 'austlii_tas');
  const links = byKey(results, 'links');

  const totalHits = totalResults(results.filter((r) => r.key !== 'links'));
  const courtHits = totalResults([...federal, ...qld, ...nsw, ...vic, ...wa, ...sa, ...nt, ...act, ...tas]);

  const identityResult = identity[0];
  const entityName =
    identityResult?.results?.[0]?.title || input.companyName || input.abn || '—';
  const abnStatus =
    identityResult?.results?.[0]?.metadata?.['Status'] ||
    identityResult?.results?.[0]?.metadata?.['ABN status'] ||
    identityResult?.results?.[0]?.status ||
    '—';

  const riskLevel: 'Low' | 'Medium' | 'High' =
    courtHits > 5 ? 'High' : courtHits > 0 ? 'Medium' : 'Low';

  const riskColor = {
    Low: colors.success,
    Medium: colors.warning,
    High: colors.danger,
  }[riskLevel];

  const riskBg = {
    Low: colors.successBg,
    Medium: colors.warningBg,
    High: colors.dangerBg,
  }[riskLevel];

  const shareReport = async () => {
    const lines: string[] = [
      `KNOW YOUR BUILDER — DUE DILIGENCE REPORT`,
      `Generated: ${now}`,
      `Entity: ${entityName}`,
      `ABN: ${input.abn || '—'}  ACN: ${input.acn || '—'}`,
      ``,
      `SUMMARY`,
      `Total records found: ${totalHits}`,
      `Court/tribunal records: ${courtHits}`,
      `Indicative risk level: ${riskLevel}`,
      ``,
      `SOURCES SEARCHED`,
      ...results.filter((r) => r.key !== 'links').map(
        (r) => `• ${r.label}: ${r.summary || (r.results?.length ?? 0) + ' results'}`
      ),
    ];
    await Share.share({ message: lines.join('\n'), title: `KYB Report — ${entityName}` });
  };

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.popToTop()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← New Search</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={shareReport} style={styles.shareBtn}>
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Entity card */}
        <View style={styles.entityCard}>
          <View style={styles.entityCardTop}>
            <View style={styles.entityInitial}>
              <Text style={styles.entityInitialText}>
                {(entityName[0] || '?').toUpperCase()}
              </Text>
            </View>
            <View style={styles.entityInfo}>
              <Text style={styles.entityName} numberOfLines={2}>{entityName}</Text>
              {input.tradingName ? (
                <Text style={styles.entitySubname}>t/a {input.tradingName}</Text>
              ) : null}
              <View style={styles.entityMeta}>
                {input.abn ? <Text style={styles.entityMetaText}>ABN {input.abn}</Text> : null}
                {input.acn ? <Text style={styles.entityMetaText}>ACN {input.acn}</Text> : null}
              </View>
            </View>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalHits}</Text>
              <Text style={styles.statLabel}>Records found</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{courtHits}</Text>
              <Text style={styles.statLabel}>Court/tribunal</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={[styles.statBox, { backgroundColor: riskBg, borderRadius: 8, padding: 6 }]}>
              <Text style={[styles.statValue, { color: riskColor }]}>{riskLevel}</Text>
              <Text style={styles.statLabel}>Risk indicator</Text>
            </View>
          </View>

          <Text style={styles.reportDate}>Report generated {now}</Text>
        </View>

        {/* Directors */}
        {input.directors.filter(Boolean).length > 0 && (
          <View style={styles.directorsCard}>
            <Text style={styles.directorsTitle}>Directors / Key Individuals Searched</Text>
            {input.directors.filter(Boolean).map((d, i) => (
              <Text key={i} style={styles.directorName}>• {d}</Text>
            ))}
          </View>
        )}

        {/* ── Identity & Registration ── */}
        <ReportSection
          title="Identity & Registration"
          icon="🏢"
          searchResults={identity}
        />

        {/* ── Payment Performance ── */}
        <ReportSection
          title="Payment Performance"
          icon="💳"
          searchResults={payment}
        />

        {/* ── Modern Slavery ── */}
        <ReportSection
          title="Modern Slavery Register"
          icon="📋"
          searchResults={modernSlavery}
        />

        {/* ── Licences ── */}
        <ReportSection
          title="Licences & Registrations"
          icon="🏗"
          searchResults={licences}
        />

        {/* ── Federal Courts ── */}
        <ReportSection
          title="Federal Courts & Commissions"
          icon="⚖️"
          searchResults={federal}
        />

        {/* ── QLD ── */}
        <ReportSection
          title="Queensland Courts & Tribunals"
          icon="🦅"
          searchResults={qld}
        />

        {/* ── NSW ── */}
        <ReportSection
          title="New South Wales Courts & Tribunals"
          icon="🦁"
          searchResults={nsw}
        />

        {/* ── VIC ── */}
        <ReportSection
          title="Victoria Courts & Tribunals"
          icon="🌿"
          searchResults={vic}
        />

        {/* ── WA ── */}
        <ReportSection
          title="Western Australia Courts & Tribunals"
          icon="☀️"
          searchResults={wa}
        />

        {/* ── SA ── */}
        <ReportSection
          title="South Australia Courts & Tribunals"
          icon="🍇"
          searchResults={sa}
        />

        {/* ── NT ── */}
        <ReportSection
          title="Northern Territory Courts & Tribunals"
          icon="🦘"
          searchResults={nt}
        />

        {/* ── ACT ── */}
        <ReportSection
          title="ACT Courts & Tribunals"
          icon="🏛"
          searchResults={act}
        />

        {/* ── TAS ── */}
        <ReportSection
          title="Tasmania Courts & Tribunals"
          icon="🌊"
          searchResults={tas}
        />

        {/* ── Additional Links ── */}
        <ReportSection
          title="Additional Databases — Manual Review"
          icon="🔗"
          searchResults={links}
          isLinkSection
        />

        {/* Disclaimer */}
        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerTitle}>Important Notice</Text>
          <Text style={styles.disclaimerText}>
            This report is based on publicly available information sourced automatically from
            government databases. It is provided for informational purposes only and does not
            constitute legal, financial or professional advice. The absence of records does not
            guarantee a clean history. You should independently verify all material information
            before making any commercial decision.
          </Text>
          <Text style={styles.disclaimerText}>
            Sources: ABR, AustLII, Payment Times Reporting Register, Modern Slavery Register,
            QBCC, and linked government databases. Generated {now}.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 16,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 2 },
  backBtnText: { ...typography.bodyMd, color: colors.white, fontWeight: '600' },
  shareBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  shareBtnText: { ...typography.labelMd, color: colors.primary },

  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  entityCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  entityCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  entityInitial: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  entityInitialText: { color: colors.white, fontSize: 24, fontWeight: '800' },
  entityInfo: { flex: 1 },
  entityName: { ...typography.heading3, color: colors.primary },
  entitySubname: { ...typography.bodyMd, color: colors.textMuted, marginTop: 2 },
  entityMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  entityMetaText: {
    ...typography.bodyXs,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
    marginBottom: 12,
  },
  statBox: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, height: 36, backgroundColor: colors.borderLight },
  statValue: { ...typography.heading2, color: colors.primary },
  statLabel: { ...typography.bodyXs, color: colors.textMuted, marginTop: 2 },
  reportDate: { ...typography.bodyXs, color: colors.textMuted, textAlign: 'center' },

  directorsCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  directorsTitle: { ...typography.labelMd, color: colors.textSecondary, marginBottom: 8 },
  directorName: { ...typography.bodyMd, color: colors.textPrimary, marginBottom: 4 },

  disclaimerBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 16,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  disclaimerTitle: { ...typography.labelMd, color: colors.textSecondary, marginBottom: 8 },
  disclaimerText: { ...typography.bodyXs, color: colors.textMuted, marginBottom: 6, lineHeight: 18 },
});
