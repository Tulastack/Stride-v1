import { RecoveryExerciseDemo } from './RecoveryExerciseDemo';
import { exerciseFor } from '../lib/recovery/motions';
import React from 'react';
import { Text, View } from 'react-native';
import { type as typo } from '../theme';
import { Sheet, SheetScroll, Button, Notice } from '../ui';

type DetailEvent = { id: string; title: string; event_type: string; scheduled_date?: string; status?: string; details?: { sets?: number; reps?: number; volume?: string; cue?: string; why?: string; cues?: string[]; exercises?: { name: string; cue?: string; sets?: number; reps?: string }[] } };
type DetailColors = { bg: string; text: string; muted: string; border: string; card: string; accent: string; accentText: string; success: string };

export function EventDetailModal({ event, colors, today, onClose, onComplete, busy = false }: { event: DetailEvent | null; colors: DetailColors; today?: string; onClose: () => void; onComplete: (event: DetailEvent) => void; busy?: boolean }) {
  const future = !!event?.scheduled_date && !!today && event.scheduled_date > today;
  const backfill = !!event?.scheduled_date && !!today && event.scheduled_date < today;
  return <Sheet visible={!!event} title={event?.title ?? 'Session'} onClose={onClose} testID="event-detail-modal">
    {event ? <><SheetScroll contentContainerStyle={{ gap: 20 }}><Text style={[typo.label, { color: colors.muted }]}>{event.event_type.replace(/_/g, ' ').toUpperCase()} / {event.scheduled_date}</Text>
      <Text style={[typo.numeric, { color: colors.text }]}>{event.details?.sets && event.details?.reps ? `${event.details.sets} sets × ${event.details.reps} reps` : event.details?.volume ?? 'Session details'}</Text>
      {event.details?.cue ? <Text style={[typo.editorial, { color: colors.text }]}>{event.details.cue}</Text> : null}
      {event.details?.exercises?.map((exercise,index) => <View key={index}><Text style={[typo.bodyMedium,{color:colors.text}]}>{exercise.name}</Text>{exercise.cue ? <Text style={[typo.body,{color:colors.muted}]}>{exercise.cue}</Text> : null}{exerciseFor(exercise.name) ? <RecoveryExerciseDemo exercise={exerciseFor(exercise.name)!}/> : null}</View>)}
      {(!event.details?.exercises?.length && ['recovery','drill'].includes(event.event_type) && exerciseFor(event.title)) ? <RecoveryExerciseDemo exercise={exerciseFor(event.title)!}/> : null}
      {event.details?.why ? <View style={{ gap: 8 }}><Text style={[typo.label, { color: colors.muted }]}>WHY THIS HELPS</Text><Text style={[typo.body, { color: colors.text }]}>{event.details.why}</Text></View> : null}
      {event.details?.cues?.length ? <View style={{ gap: 12 }}><Text style={[typo.label, { color: colors.muted }]}>KEY CUES</Text>{event.details.cues.map((cue, index) => <Text key={index} style={[typo.body, { color: colors.text }]}>{index + 1}. {cue}</Text>)}</View> : null}
      {future ? <Notice>Scheduled for a day that hasn't come round yet. You can tick it off on the day.</Notice> : backfill ? <Notice>Logging this now records the work. It won't bring back the streak that day broke.</Notice> : null}
      {event.status === 'completed' ? <Text style={[typo.bodyMedium, { color: colors.success }]}>Session completed</Text> : null}
    </SheetScroll><View style={{ flexDirection: 'row', gap: 8 }}><Button label="Close" testID="event-detail-close" variant="secondary" onPress={onClose} style={{ flex: 1 }} />{!future && event.status !== 'completed' && event.status !== 'skipped' ? <Button label="Mark complete" testID="event-detail-complete" loading={busy} onPress={() => onComplete(event)} style={{ flex: 1 }} /> : null}</View></> : null}
  </Sheet>;
}
