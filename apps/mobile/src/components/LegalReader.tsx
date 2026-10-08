import React from 'react';
import { View, Text } from 'react-native';
import { Sheet, SheetScroll, Button } from '../ui';
import { useTheme } from '../context/ThemeContext';
import { space, type as typo } from '../theme';
import type { LegalDoc } from '../content/legal';

export function LegalReader({ document, onClose }: { document: LegalDoc | null; onClose: () => void }) {
  const { colors } = useTheme();
  return <Sheet visible={!!document} title={document?.title ?? 'Privacy'} onClose={onClose}><SheetScroll contentContainerStyle={{ gap: space.xl }} showsVerticalScrollIndicator>{document?.sections.map((section) => <View key={section.heading} style={{ gap: space.sm }}><Text style={[typo.bodyMedium, { color: colors.text }]}>{section.heading}</Text><Text style={[typo.body, { color: colors.muted }]}>{section.body}</Text></View>)}</SheetScroll><Button label="Done reading" testID="legal-close-btn" variant="secondary" onPress={onClose} /></Sheet>;
}
