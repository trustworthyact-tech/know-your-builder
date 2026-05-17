import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { ResultItem } from '../types';
import { colors, typography, shadows } from '../theme';

interface Props {
  item: ResultItem;
  showJurisdiction?: boolean;
}

export function ResultCard({ item, showJurisdiction }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = item.metadata && Object.keys(item.metadata).length > 0;
  const hasExtras = hasMetadata || item.description;

  const openUrl = () => {
    if (item.url) Linking.openURL(item.url).catch(() => null);
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={hasExtras ? () => setExpanded((e) => !e) : openUrl}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          {showJurisdiction && item.jurisdiction && (
            <View style={styles.jurisdictionBadge}>
              <Text style={styles.jurisdictionText}>{item.jurisdiction}</Text>
            </View>
          )}
          <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
            {item.title}
          </Text>
          {item.date && <Text style={styles.date}>{item.date}</Text>}
          {item.status && (
            <View
              style={[
                styles.statusBadge,
                item.status.toLowerCase().includes('active')
                  ? styles.statusActive
                  : styles.statusOther,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  item.status.toLowerCase().includes('active')
                    ? styles.statusTextActive
                    : styles.statusTextOther,
                ]}
              >
                {item.status}
              </Text>
            </View>
          )}
        </View>
        {hasExtras && (
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {item.description && (
            <Text style={styles.description}>{item.description}</Text>
          )}
          {hasMetadata && (
            <View style={styles.metadata}>
              {Object.entries(item.metadata!).map(([k, v]) =>
                v ? (
                  <View key={k} style={styles.metaRow}>
                    <Text style={styles.metaKey}>{k}</Text>
                    <Text style={styles.metaValue}>{v}</Text>
                  </View>
                ) : null
              )}
            </View>
          )}
          {item.url && (
            <TouchableOpacity style={styles.linkBtn} onPress={openUrl}>
              <Text style={styles.linkBtnText}>View source →</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!hasExtras && item.url && (
        <TouchableOpacity style={styles.inlineLink} onPress={openUrl}>
          <Text style={styles.inlineLinkText}>Open →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
  },
  headerLeft: { flex: 1 },
  title: { ...typography.bodyMd, color: colors.textPrimary, fontWeight: '500' },
  date: { ...typography.bodyXs, color: colors.textMuted, marginTop: 4 },
  chevron: { color: colors.textMuted, fontSize: 12, marginLeft: 8, marginTop: 2 },
  jurisdictionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  jurisdictionText: { ...typography.labelSm, color: colors.primary },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 6,
  },
  statusActive: { backgroundColor: colors.successBg },
  statusOther: { backgroundColor: colors.surfaceAlt },
  statusText: { ...typography.labelSm },
  statusTextActive: { color: colors.success },
  statusTextOther: { color: colors.textSecondary },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  description: { ...typography.bodySm, color: colors.textSecondary, marginTop: 10 },
  metadata: { marginTop: 10 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  metaKey: { ...typography.labelSm, color: colors.textSecondary, flex: 1 },
  metaValue: { ...typography.bodySm, color: colors.textPrimary, flex: 2, textAlign: 'right' },
  linkBtn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  linkBtnText: { ...typography.labelMd, color: colors.white },
  inlineLink: { paddingHorizontal: 14, paddingBottom: 10 },
  inlineLinkText: { ...typography.labelMd, color: colors.primaryLight },
});
