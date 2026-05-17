import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { colors, typography } from '../theme';

interface Props extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
}

export function FormInput({ label, hint, error, style, ...props }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <TextInput
        style={[styles.input, error ? styles.inputError : undefined, style]}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
        {...props}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { ...typography.labelMd, color: colors.textSecondary, marginBottom: 4 },
  hint: { ...typography.bodyXs, color: colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.danger },
  error: { ...typography.bodyXs, color: colors.danger, marginTop: 4 },
});
