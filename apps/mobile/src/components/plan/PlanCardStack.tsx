import React, { useState } from 'react';
import { View, Text } from 'react-native';
import type { Palette } from '../../theme';
import { type as typo, space } from '../../theme';
import type { PlanDayCard } from '../../lib/planCards';
import { volumeLabel } from '../../lib/planCards';
import { Sheet, SheetScroll, Button, Notice } from '../../ui';

export interface PlanCardStackProps {
  cards: PlanDayCard[]; colors: Palette;
  onAccept: (card: PlanDayCard) => void | Promise<void>;
  onSkipAll: (remaining: PlanDayCard[]) => void | Promise<void>;
  onDone: () => void;
}

export function PlanCardStack({ cards, colors, onAccept, onSkipAll, onDone }: PlanCardStackProps) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const card = cards[index];
  const act = async (kind: 'next' | 'all' | 'dismiss') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (kind === 'dismiss') { await onSkipAll(cards.slice(index)); onDone(); }
      else if (kind === 'all') { await Promise.all(cards.slice(index).map(onAccept)); onDone(); }
      else { await onAccept(card); if (index === cards.length - 1) onDone(); else setIndex(index + 1); }
    } catch { setError('Could not save your review. Try again. Your scheduled sessions are still in the plan.'); }
    finally { setBusy(false); }
  };
  if (!card) return null;
  return <Sheet visible title="Your next chapter." testID="plan-card-stack" onClose={() => { if (!busy) act('dismiss'); }}>
    <View testID="plan-card-top" style={{ gap: space.lg }}><Text style={[typo.label, { color: colors.goldInk }]}>SCHEDULED BY YOUR COACH / {index + 1} OF {cards.length}</Text><View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}><Text style={[typo.numeric, { color: colors.text }]}>{card.dayNumber}</Text><View><Text style={[typo.caption, { color: colors.muted }]}>{card.weekday} · {card.month}</Text><Text style={[typo.h2, { color: colors.text }]}>{card.focus}</Text></View></View></View>
    <SheetScroll testID="day-card-sessions" contentContainerStyle={{ gap: 16 }} style={{ maxHeight: 280 }}>{card.events.map((event) => <View key={event.id} style={{ gap: 4, borderBottomWidth: 0.5, borderColor: colors.border, paddingBottom: 16 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>{event.title}</Text><Text style={[typo.caption, { color: colors.goldInk }]}>{volumeLabel(event)}</Text>{event.details?.cue ? <Text style={[typo.body, { color: colors.muted }]}>{event.details.cue}</Text> : null}</View>)}</SheetScroll>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Next day" variant="secondary" loading={busy} onPress={() => act('next')} style={{ flex: 1 }} /><Button label="View in my plan" loading={busy} onPress={() => act('all')} style={{ flex: 1 }} /></View>
    <Button label="Review later" testID="plan-card-skip" disabled={busy} variant="quiet" onPress={() => act('dismiss')} />
  </Sheet>;
}
