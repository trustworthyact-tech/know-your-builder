import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from 'react-native';
import { SearchResult, ResultItem } from '../types';
import { ResultCard } from './ResultCard';
import { colors, typography, shadows } from '../theme';

interface Props {
  title: string;
  icon: string;
  searchResults: SearchResult[];
  /** If true, renders link-type results as tappable rows instead of ResultCards */
  isLinkSection?: boolean;
}

export function ReportSection({ title, icon, searchResults, isLinkSection }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const allResults: ResultItem[] = searchResults.flatMap((sr) => sr.results || []);
  const hasResults = allResults.length > 0;

  const summaryTexts = searchResults
    .filter((sr) => sr.summary)
    .map((sr) => sr.summary as string);

  const directSources = searchResults
    .filter((sr) => sr.searchUrl)
    .map((sr) => ({ label: sr.source || sr.label, url: sr.searchUrl as string }));

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setCollapsed((c) => !c)}
        activeOpacity={0.8}
      >
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionIcon}>{icon}</Text>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {hasResults && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{allResults.length}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.chevron}>{collapsed ? '▼' : '▲'}</Text>
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.sectionBody}>
          {/* Summaries */}
          {summaryTexts.map((s, i) => (
            <Text key={i} style={styles.summary}>
              {s}
            </Text>
          ))}

          {/* Sources covered */}
          {searchResults.some((sr) => sr.sources && sr.sources.length > 0) && (
            <View style={styles.sourcesWrap}>
              <Text style={styles.sourcesLabel}>Databases searched:</Text>
              {searchResults
                .flatMap((sr) => sr.sources || [])
                .map((src, i) => (
                  <Text key={i} style={styles.sourceItem}>• {src}</Text>
                ))}
            </View>
          )}

          {/* Results */}
          {isLinkSection ? (
            allResults.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={styles.linkRow}
                onPress={() => item.url && Linking.openURL(item.url).catch(() => null)}
                activeOpacity={0.7}
              >
                <View style={styles.linkRowLeft}>
                  {item.jurisdiction && (
                    <View style={styles.jBadge}>
                      <Text style={styles.jBadgeText}>{item.jurisdiction}</Text>
                    </View>
                  )}
                  <Text style={styles.linkTitle}>{item.title}</Text>
                  {item.description && (
                    <Text style={styles.linkDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                </View>
                <Text style={styles.linkArrow}>→</Text>
              </TouchableOpacity>
            ))
          ) : (
            hasResults
              ? allResults.map((item, i) => <ResultCard key={i} item={item} />)
              : <Text style={styles.noResults}>No records found in automated search</Text>
          )}

          {/* Direct source links */}
          {!isLinkSection && directSources.length > 0 && (
            <View style={styles.directLinks}>
              <Text style={styles.directLinksLabel}>Verify directly:</Text>
              {directSources.map((src, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => Linking.openURL(src.url).catch(() => null)}
                >
                  <Text style={styles.directLink}>{src.label} →</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primary,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  sectionIcon: { fontSize: 18, marginRight: 10 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  sectionTitle: { ...typography.heading4, color: colors.white, flex: 1 },
  countBadge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    marginLeft: 8,
  },
  countText: { ...typography.labelSm, color: colors.primary },
  chevron: { color: colors.white, fontSize: 12, marginLeft: 8 },
  sectionBody: { padding: 16 },
  summary: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginBottom: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    padding: 10,
  },
  sourcesWrap: { marginBottom: 12 },
  sourcesLabel: { ...typography.labelSm, color: colors.textSecondary, marginBottom: 4 },
  sourceItem: { ...typography.bodyXs, color: colors.textMuted, marginBottom: 2 },
  noResults: { ...typography.bodySm, color: colors.textMuted, fontStyle: 'italic', padding: 8 },
  directLinks: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  directLinksLabel: { ...typography.labelSm, color: colors.textMuted, marginBottom: 6 },
  directLink: { ...typography.bodySm, color: colors.primaryLight, marginBottom: 4 },
  // Link section styles
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  linkRowLeft: { flex: 1 },
  jBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.infoBg,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 4,
  },
  jBadgeText: { ...typography.labelSm, color: colors.info },
  linkTitle: { ...typography.bodyMd, color: colors.primary, fontWeight: '600' },
  linkDesc: { ...typography.bodyXs, color: colors.textMuted, marginTop: 2 },
  linkArrow: { ...typography.heading3, color: colors.primaryLight, marginLeft: 10 },
});
