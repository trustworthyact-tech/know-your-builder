import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography } from '../theme';

interface Props {
  directors: string[];
  onChange: (directors: string[]) => void;
}

export function DirectorInput({ directors, onChange }: Props) {
  const update = (index: number, value: string) => {
    const next = [...directors];
    next[index] = value;
    onChange(next);
  };

  const add = () => onChange([...directors, '']);

  const remove = (index: number) => {
    const next = directors.filter((_, i) => i !== index);
    onChange(next.length === 0 ? [''] : next);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Directors / Key Individuals</Text>
      <Text style={styles.hint}>
        Add names to include director searches in court and regulatory databases
      </Text>
      {directors.map((name, i) => (
        <View key={i} style={styles.row}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(v) => update(i, v)}
            placeholder={`Director ${i + 1} full name`}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />
          {directors.length > 1 && (
            <TouchableOpacity style={styles.removeBtn} onPress={() => remove(i)}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity style={styles.addBtn} onPress={add}>
        <Text style={styles.addBtnText}>+ Add director</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { ...typography.labelMd, color: colors.textSecondary, marginBottom: 4 },
  hint: { ...typography.bodyXs, color: colors.textMuted, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  removeBtn: {
    marginLeft: 8,
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.dangerBg,
  },
  removeBtnText: { color: colors.danger, fontSize: 16 },
  addBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginTop: 4,
  },
  addBtnText: { ...typography.labelMd, color: colors.primaryLight },
});
