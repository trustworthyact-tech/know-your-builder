import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SearchResult } from '../types';
import { colors, typography } from '../theme';

interface Props {
  item: SearchResult;
}

export function SearchProgressItem({ item }: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    if (item.status === 'searching') {
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 1000, useNativeDriver: true })
      ).start();
    } else {
      spin.stopAnimation();
    }
  }, [item.status]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const iconMap: Record<string, string> = {
    idle: '○',
    searching: '◌',
    done: item.results && item.results.length > 0 ? '●' : '○',
    error: '✕',
  };

  const statusColors: Record<string, string> = {
    idle: colors.textMuted,
    searching: colors.primary,
    done: item.results && item.results.length > 0 ? colors.success : colors.textMuted,
    error: colors.danger,
  };

  const statusColor = statusColors[item.status] || colors.textMuted;

  const resultCount =
    item.status === 'done' && item.results
      ? item.results.length
      : undefined;

  return (
    <Animated.View style={[styles.row, { opacity: fadeIn }]}>
      <View style={[styles.iconWrap, { borderColor: statusColor }]}>
        {item.status === 'searching' ? (
          <Animated.Text style={[styles.icon, { color: statusColor, transform: [{ rotate }] }]}>
            ◌
          </Animated.Text>
        ) : (
          <Text style={[styles.icon, { color: statusColor }]}>{iconMap[item.status]}</Text>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.label} numberOfLines={1}>
          {item.label}
        </Text>
        {item.status === 'searching' && (
          <Text style={[styles.statusText, { color: colors.primary }]}>Searching…</Text>
        )}
        {item.status === 'done' && (
          <Text
            style={[
              styles.statusText,
              { color: resultCount && resultCount > 0 ? colors.success : colors.textMuted },
            ]}
          >
            {resultCount && resultCount > 0 ? `${resultCount} result(s) found` : 'No results'}
          </Text>
        )}
        {item.status === 'error' && (
          <Text style={[styles.statusText, { color: colors.danger }]}>
            {item.error || 'Search failed'}
          </Text>
        )}
      </View>

      {item.status === 'done' && resultCount !== undefined && resultCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{resultCount}</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: { fontSize: 14, fontWeight: '700' },
  content: { flex: 1 },
  label: { ...typography.bodyMd, color: colors.textPrimary, fontWeight: '500' },
  statusText: { ...typography.bodyXs, marginTop: 2 },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: { ...typography.labelSm, color: colors.white },
});
