import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SearchProgressItem } from '../components/SearchProgressItem';
import { runDueDiligence, checkServer } from '../services/api';
import { RootStackParamList, SearchResult } from '../types';
import { colors, typography, shadows } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Searching'>;
  route: RouteProp<RootStackParamList, 'Searching'>;
};

// All expected search keys, in display order
const INITIAL_SEARCHES: SearchResult[] = [
  { key: 'abn', label: 'ABR — Business Register', status: 'idle' },
  { key: 'paymentTimes', label: 'Payment Times Reporting Register', status: 'idle' },
  { key: 'modernSlavery', label: 'Modern Slavery Statements Register', status: 'idle' },
  { key: 'qbcc', label: 'QBCC — Licence Register', status: 'idle' },
  { key: 'austlii_federal', label: 'Federal Courts (AustLII)', status: 'idle' },
  { key: 'austlii_qld', label: 'QLD Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_nsw', label: 'NSW Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_vic', label: 'VIC Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_wa', label: 'WA Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_sa', label: 'SA Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_nt', label: 'NT Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_act', label: 'ACT Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'austlii_tas', label: 'TAS Courts & Tribunals (AustLII)', status: 'idle' },
  { key: 'links', label: 'Additional Database Links', status: 'idle' },
];

export function SearchingScreen({ navigation, route }: Props) {
  const { input } = route.params;
  const [searches, setSearches] = useState<SearchResult[]>(INITIAL_SEARCHES);
  const [phase, setPhase] = useState<'server-check' | 'running' | 'done' | 'error'>('server-check');
  const [errorMsg, setErrorMsg] = useState('');
  const resultsRef = useRef<SearchResult[]>([]);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const doneCount = searches.filter((s) => s.status === 'done' || s.status === 'error').length;
  const total = INITIAL_SEARCHES.length;
  const progress = total > 0 ? doneCount / total : 0;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const updateSearch = (incoming: SearchResult) => {
    setSearches((prev) =>
      prev.map((s) => (s.key === incoming.key ? { ...s, ...incoming } : s))
    );
    if (incoming.status === 'done' || incoming.status === 'error') {
      resultsRef.current = resultsRef.current
        .filter((r) => r.key !== incoming.key)
        .concat(incoming);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const serverOk = await checkServer();
      if (cancelled) return;

      if (!serverOk) {
        setPhase('error');
        setErrorMsg(
          'Cannot reach the search server at localhost:3001.\n\nPlease start it with:\n\ncd ~/know-your-builder/server\nnode index.js'
        );
        return;
      }

      setPhase('running');
      // Mark all as searching initially
      setSearches((prev) => prev.map((s) => ({ ...s, status: 'searching' })));

      try {
        await runDueDiligence(input, updateSearch);
        if (!cancelled) setPhase('done');
      } catch (err: any) {
        if (!cancelled) {
          setPhase('error');
          setErrorMsg(err.message || 'An unexpected error occurred');
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase === 'done') {
      // Auto-navigate after a short delay so the user sees completion
      const timer = setTimeout(() => {
        navigation.replace('Report', {
          results: resultsRef.current,
          input,
        });
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const goToReport = () =>
    navigation.replace('Report', { results: resultsRef.current, input });

  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <Text style={styles.headerTitle}>Running Due Diligence</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {input.companyName || input.abn}
          </Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: barWidth }]} />
        </View>
        <Text style={styles.progressLabel}>
          {phase === 'server-check'
            ? 'Connecting to server…'
            : phase === 'error'
            ? 'Error'
            : phase === 'done'
            ? 'Complete — navigating to report…'
            : `${doneCount} of ${total} searches complete`}
        </Text>
      </View>

      {phase === 'error' ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Server Not Running</Text>
          <Text style={styles.errorMsg}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.retryBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {searches.map((item) => (
              <SearchProgressItem key={item.key} item={item} />
            ))}
          </ScrollView>

          {phase === 'done' && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.viewReportBtn} onPress={goToReport}>
                <Text style={styles.viewReportBtnText}>View Report →</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    backgroundColor: colors.primary,
    padding: 20,
    paddingTop: 24,
    ...shadows.card,
  },
  headerInner: { marginBottom: 16 },
  headerTitle: { ...typography.heading3, color: colors.white },
  headerSubtitle: { ...typography.bodyMd, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  progressLabel: { ...typography.bodyXs, color: 'rgba(255,255,255,0.8)' },

  list: { flex: 1 },
  listContent: { paddingVertical: 8 },

  footer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  viewReportBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.card,
  },
  viewReportBtnText: { ...typography.heading4, color: colors.white },

  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorIcon: { fontSize: 48, marginBottom: 16 },
  errorTitle: { ...typography.heading3, color: colors.danger, marginBottom: 12, textAlign: 'center' },
  errorMsg: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  retryBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  retryBtnText: { ...typography.heading4, color: colors.white },
});
