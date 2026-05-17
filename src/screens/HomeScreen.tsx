import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FormInput } from '../components/FormInput';
import { DirectorInput } from '../components/DirectorInput';
import { RootStackParamList, BuilderInput } from '../types';
import { colors, typography, shadows } from '../theme';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

function formatABN(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

function formatACN(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export function HomeScreen({ navigation }: Props) {
  const [form, setForm] = useState<BuilderInput>({
    abn: '',
    acn: '',
    companyName: '',
    tradingName: '',
    directors: [''],
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BuilderInput, string>>>({});

  const update = (field: keyof BuilderInput) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!form.companyName.trim() && !form.abn.trim()) {
      newErrors.companyName = 'Enter a company/business name or ABN';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const start = () => {
    if (!validate()) return;
    navigation.navigate('Searching', { input: form });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>KYB</Text>
        </View>
        <Text style={styles.heroTitle}>Know Your Builder</Text>
        <Text style={styles.heroSubtitle}>
          Automated due diligence across 40+ Australian government databases
        </Text>
      </View>

      {/* Form card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Builder Details</Text>
        <Text style={styles.cardSubtitle}>
          Enter as much information as you have. More details = more accurate results.
        </Text>

        <FormInput
          label="ABN"
          hint="Australian Business Number — 11 digits"
          placeholder="e.g. 51 824 753 556"
          value={form.abn}
          onChangeText={(v) => update('abn')(formatABN(v))}
          keyboardType="numeric"
          autoCapitalize="none"
        />

        <FormInput
          label="ACN"
          hint="Australian Company Number — 9 digits (if a company)"
          placeholder="e.g. 123 456 789"
          value={form.acn}
          onChangeText={(v) => update('acn')(formatACN(v))}
          keyboardType="numeric"
          autoCapitalize="none"
        />

        <FormInput
          label="Company / Business Name *"
          hint="Registered legal name of the entity"
          placeholder="e.g. Acme Building Group Pty Ltd"
          value={form.companyName}
          onChangeText={update('companyName')}
          error={errors.companyName}
          autoCapitalize="words"
        />

        <FormInput
          label="Trading Name"
          hint="If different from the registered name"
          placeholder="e.g. Acme Builders"
          value={form.tradingName}
          onChangeText={update('tradingName')}
          autoCapitalize="words"
        />

        <DirectorInput
          directors={form.directors}
          onChange={(d) => setForm((f) => ({ ...f, directors: d }))}
        />
      </View>

      {/* What we check */}
      <View style={styles.checklistCard}>
        <Text style={styles.checklistTitle}>What we search</Text>
        {[
          ['🏛', 'ABR, ASIC & company notices'],
          ['💳', 'Payment Times Reporting Register'],
          ['⚖️', 'Federal & all state/territory courts'],
          ['🏗', 'QBCC, NSW Fair Trading & state licence registers'],
          ['🔍', 'Modern Slavery & WGEA registers'],
          ['📋', '40+ court, tribunal & regulatory databases'],
        ].map(([icon, text], i) => (
          <View key={i} style={styles.checklistRow}>
            <Text style={styles.checklistIcon}>{icon}</Text>
            <Text style={styles.checklistText}>{text}</Text>
          </View>
        ))}
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This tool searches publicly available databases only. Results should be verified and
          do not constitute legal or financial advice. Some records may not appear if the
          entity has not been involved in relevant proceedings.
        </Text>
      </View>

      {/* CTA */}
      <TouchableOpacity style={styles.searchBtn} onPress={start} activeOpacity={0.85}>
        <Text style={styles.searchBtnText}>Start Due Diligence →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, paddingBottom: 40 },

  hero: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    ...shadows.card,
  },
  logoText: { color: colors.white, fontSize: 22, fontWeight: '800' },
  heroTitle: { ...typography.heading1, color: colors.primary, textAlign: 'center' },
  heroSubtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardTitle: { ...typography.heading3, color: colors.primary, marginBottom: 4 },
  cardSubtitle: { ...typography.bodyXs, color: colors.textMuted, marginBottom: 20 },

  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  checklistTitle: { ...typography.heading4, color: colors.primary, marginBottom: 12 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  checklistIcon: { fontSize: 16, marginRight: 10, width: 24 },
  checklistText: { ...typography.bodyMd, color: colors.textSecondary, flex: 1 },

  disclaimer: {
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  disclaimerText: { ...typography.bodyXs, color: colors.warning },

  searchBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    ...shadows.card,
  },
  searchBtnText: { ...typography.heading4, color: colors.white },
});
