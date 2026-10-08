import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { space, radius, type as typo } from '../../theme';
import { Sheet, SheetScroll, Notice, Button } from '../../ui';
import type { DrillRec } from '../../types/analysis';
import { PoseSnapshot } from './PoseSnapshot';

export function DrillCard({ rec, testID, analysisId, seekMs }: { rec: DrillRec; testID?: string; analysisId?: string; seekMs?: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return <><Pressable accessibilityRole="button" accessibilityLabel={`Practice ${rec.drillName}`} testID={testID ?? `drill-${rec.drillId}`} onPress={() => setOpen(true)} style={{ padding: space.xl, backgroundColor: colors.cardAlt, borderRadius: radius.md, gap: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[typo.label, { color: colors.goldInk, flex: 1 }]}>PRACTICE / {rec.sets} × {rec.reps}</Text><ArrowUpRight color={colors.goldInk} size={18} /></View>
    <Text style={[typo.h2, { color: colors.text }]}>{rec.drillName}</Text><Text style={[typo.body, { color: colors.muted }]}>{rec.cue}</Text>
  </Pressable><Sheet visible={open} title={rec.drillName} onClose={() => setOpen(false)}><SheetScroll contentContainerStyle={{ gap: 20 }}>
    {analysisId && seekMs != null ? <View testID={`your-form-${rec.drillId}`}><PoseSnapshot analysisId={analysisId} tMs={seekMs} /><Text style={[typo.caption, { color: colors.muted }]}>Tracked 2D joints from your own video, not a demonstration</Text></View> : null}
    <Text style={[typo.numeric, { color: colors.goldInk }]}>{rec.sets} <Text style={typo.caption}>sets ×</Text> {rec.reps} <Text style={typo.caption}>reps</Text></Text>
    <Text style={[typo.editorial, { color: colors.text }]}>{rec.cue}</Text><Text style={[typo.label, { color: colors.muted }]}>WHY THIS PRACTICE</Text><Text style={[typo.body, { color: colors.text }]}>{rec.rationale || 'Follow the prescribed cue and dose. Ask your coach if you need more guidance.'}</Text>
    <Notice>Video demonstration is not available for this drill yet. No simulated movement is shown as a real demonstration.</Notice>
    <Text style={[typo.caption, { color: colors.muted }]}>Scheduling is a separate approval below your report. Stop if you feel pain.</Text>
  </SheetScroll><Button label="Back to report" variant="secondary" onPress={() => setOpen(false)} /></Sheet></>;
}
