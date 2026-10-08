import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type as typo, radius } from '../theme';
import { toDateKey, fromDateKey, addDaysToKey, todayKey } from '../lib/dates';
import { Sheet, Button, Notice, SegmentedControl } from '../ui';

interface DrillSuggestion { id: string; drill_key: string; drill_name: string; suggested_date: string; status: 'pending' | 'approved' | 'skipped' }
interface Props { suggestion: DrillSuggestion; onApprove: (id: string, date: string) => Promise<void>; onSkip: (id: string) => Promise<void> }

export function DrillSuggestionCard({ suggestion, onApprove, onSkip }: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState(suggestion.status);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [date, setDate] = useState(suggestion.suggested_date);
  const [error, setError] = useState('');
  const days = Array.from({ length: 7 }, (_, index) => addDaysToKey(todayKey(), index));
  const commit = async (approve: boolean) => {
    if (loading) return;
    setLoading(true); setError('');
    try { if (approve) await onApprove(suggestion.id, date); else await onSkip(suggestion.id); setStatus(approve ? 'approved' : 'skipped'); setPicker(false); }
    catch { setError('Could not save your choice. Please try again.'); }
    finally { setLoading(false); }
  };
  if (status === 'skipped') return null;
  if (status === 'approved') return <View testID={`suggestion-card-${suggestion.id}`}><Notice>{suggestion.drill_name} added to calendar</Notice></View>;
  return <><View testID={`suggestion-card-${suggestion.id}`} accessibilityLabel={`suggestion-card-${suggestion.id}`} style={{ backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 20, gap: 12 }}><Text style={[typo.h2, { color: colors.text }]}>{suggestion.drill_name}</Text><Text style={[typo.caption, { color: colors.muted }]}>Suggested: {suggestion.suggested_date}</Text>{error && !picker ? <Notice tone="error">{error}</Notice> : null}<View style={{ flexDirection: 'row', gap: 8 }}><Button label="Skip" testID={`skip-suggestion-${suggestion.id}`} accessibilityLabel={`skip-suggestion-${suggestion.id}`} variant="secondary" disabled={loading} onPress={() => commit(false)} /><Button label="Add to my plan" testID={`approve-suggestion-${suggestion.id}`} accessibilityLabel={`approve-suggestion-${suggestion.id}`} disabled={loading} onPress={() => setPicker(true)} style={{ flex: 1 }} /></View></View>
    <Sheet visible={picker} title="Schedule Drill" onClose={() => { if (!loading) setPicker(false); }}><Text style={[typo.body, { color: colors.text }]}>{suggestion.drill_name}</Text><SegmentedControl value={date} onChange={setDate} options={days.map((day) => ({ value: day, label: fromDateKey(day).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + fromDateKey(day).getDate() }))} /><Text style={[typo.caption, { color: colors.muted }]}>Selected date: {date}</Text>{error ? <Notice tone="error">{error}</Notice> : null}<Button label="Confirm Date" testID={`confirm-date-${suggestion.id}`} loading={loading} onPress={() => commit(true)} /><Button label="Cancel" variant="quiet" disabled={loading} onPress={() => setPicker(false)} /></Sheet>
  </>;
}
