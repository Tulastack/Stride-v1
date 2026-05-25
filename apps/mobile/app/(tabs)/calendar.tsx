import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Animated } from 'react-native';
import { Calendar as CalendarIcon, CheckSquare, Plus, Flame, Award, Check } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

const AnimatedDayCard = ({ day, isSelected, onPress }: any) => {
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleValue, { toValue: 0.9, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleValue, { toValue: 1, useNativeDriver: true, friction: 3 }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={() => onPress(day.fullDate)}
      style={{ flex: 1 }}
    >
      <Animated.View style={[styles.dayCard, isSelected && styles.selectedDayCard, { transform: [{ scale: scaleValue }] }]}>
        {isSelected ? (
          <LinearGradient colors={['#FF453A', '#FF375F']} style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]} />
        ) : (
          <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
        )}
        <Text style={[styles.dayLabel, isSelected && styles.selectedDayLabel]}>{day.label}</Text>
        <Text style={[styles.dayNum, isSelected && styles.selectedDayNum]}>{day.date}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const AnimatedCheckButton = ({ isCompleted, onPress }: any) => {
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleValue, { toValue: 0.8, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleValue, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true })
    ]).start();
    onPress();
  };

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={handlePress}>
      <Animated.View style={[styles.checkButton, isCompleted && styles.checkedButton, { transform: [{ scale: scaleValue }] }]}>
        {isCompleted ? <Check color="#FFFFFF" size={20} strokeWidth={3} /> : <View style={styles.emptyCheck} />}
      </Animated.View>
    </TouchableOpacity>
  );
};

export default function CalendarScreen() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState('2026-05-24');

  const listFadeAnim = useRef(new Animated.Value(0)).current;
  const listSlideAnim = useRef(new Animated.Value(20)).current;

  const animateList = () => {
    listFadeAnim.setValue(0);
    listSlideAnim.setValue(20);
    Animated.parallel([
      Animated.timing(listFadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(listSlideAnim, { toValue: 0, bounciness: 8, useNativeDriver: true })
    ]).start();
  };

  useEffect(() => {
    animateList();
  }, [selectedDay, events.length]);

  const fetchCalendarEvents = async () => {
    setLoading(true);
    try {
      const data = await strideApi.listEvents('2026-05-20', '2026-05-30');
      setEvents(data);
    } catch (err) {
      setEvents([
        {
          id: 'event-1', title: 'A-Skips Corrective Session', event_type: 'drill', scheduled_date: '2026-05-24', status: 'scheduled',
          details: { volume: '3 sets of 20 meters', cue: 'Punch foot down directly under hip' }, completion_note: null,
        },
        {
          id: 'event-2', title: 'Wall Drills Posture Practice', event_type: 'drill', scheduled_date: '2026-05-25', status: 'scheduled',
          details: { volume: '3 sets of 5 reps', cue: 'Step over opposite knee' }, completion_note: null,
        },
        {
          id: 'event-3', title: 'Active Rest Day', event_type: 'rest', scheduled_date: '2026-05-26', status: 'scheduled',
          details: null, completion_note: null,
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarEvents();
  }, []);

  const handleToggleComplete = async (eventId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'completed' ? 'scheduled' : 'completed';
    const note = nextStatus === 'completed' ? 'Executed with elite posture.' : '';

    try {
      await strideApi.updateEvent(eventId, { status: nextStatus, completionNote: note });
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, status: nextStatus, completion_note: note } : e)));
    } catch (err) {
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, status: nextStatus, completion_note: note } : e)));
    }
  };

  const handleQuickAddDrill = async () => {
    try {
      const newDrill = { title: 'Knee Drive A-Skips Practice', eventType: 'drill', scheduledDate: selectedDay, details: { volume: '3x20m', cue: 'Step over opposite knee' } };
      const dbDrill = await strideApi.createEvent(newDrill);
      setEvents((prev) => [...prev, dbDrill]);
    } catch (err) {
      const mockDrill = { id: `mock-event-${Date.now()}`, title: 'Knee Drive A-Skips Practice', event_type: 'drill', scheduled_date: selectedDay, status: 'scheduled', details: { volume: '3x20m', cue: 'Step over opposite knee' }, completion_note: null };
      setEvents((prev) => [...prev, mockDrill]);
    }
  };

  const filteredEvents = events.filter((e) => e.scheduled_date === selectedDay);

  const daysOfWeek = [
    { label: 'Wed', date: '20', fullDate: '2026-05-20' },
    { label: 'Thu', date: '21', fullDate: '2026-05-21' },
    { label: 'Fri', date: '22', fullDate: '2026-05-22' },
    { label: 'Sat', date: '23', fullDate: '2026-05-23' },
    { label: 'Sun', date: '24', fullDate: '2026-05-24' },
    { label: 'Mon', date: '25', fullDate: '2026-05-25' },
    { label: 'Tue', date: '26', fullDate: '2026-05-26' },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Training Schedule</Text>

        <View style={styles.calendarStrip}>
          {daysOfWeek.map((day, idx) => (
            <AnimatedDayCard key={idx} day={day} isSelected={selectedDay === day.fullDate} onPress={setSelectedDay} />
          ))}
        </View>

        <View style={styles.eventsSection}>
          <Text style={styles.sectionHeader}>
            {selectedDay === '2026-05-24' ? "Today's Workouts" : `Workouts for ${selectedDay}`}
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color="#FF453A" style={{ marginTop: 40 }} />
          ) : (
            <Animated.View style={{ opacity: listFadeAnim, transform: [{ translateY: listSlideAnim }], gap: 16 }}>
              {filteredEvents.length > 0 ? (
                filteredEvents.map((event) => {
                  const isCompleted = event.status === 'completed';
                  return (
                    <View key={event.id} style={[styles.eventCard, isCompleted && styles.completedEventCard]}>
                      <BlurView intensity={isCompleted ? 10 : 25} tint="dark" style={StyleSheet.absoluteFillObject} />
                      <View style={styles.eventInfo}>
                        <Text style={[styles.eventTitle, isCompleted && styles.completedText]}>{event.title}</Text>
                        <Text style={[styles.eventTypeBadge, isCompleted && { color: '#8E94A8' }]}>{event.event_type.toUpperCase()}</Text>
                        
                        {event.details && (
                          <View style={styles.eventDetailsBox}>
                            <Text style={styles.eventDetailsText}>Volume: {event.details.volume}</Text>
                            <Text style={styles.eventDetailsCue}>Cue: "{event.details.cue}"</Text>
                          </View>
                        )}
                        {event.completion_note && <Text style={styles.completionNote}>Note: {event.completion_note}</Text>}
                      </View>
                      <AnimatedCheckButton isCompleted={isCompleted} onPress={() => handleToggleComplete(event.id, event.status)} />
                    </View>
                  );
                })
              ) : (
                <View style={styles.restDayCard}>
                  <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
                  <Award color="#FF9F0A" size={40} />
                  <Text style={styles.restDayTitle}>Active Recovery</Text>
                  <Text style={styles.restDaySub}>Allow your muscle fibers and neural pathways to fully synthesize your technique adjustments.</Text>

                  <TouchableOpacity activeOpacity={0.8} onPress={handleQuickAddDrill}>
                    <LinearGradient colors={['#FF453A', '#FF375F']} style={styles.scheduleBtn} start={{x: 0, y: 0}} end={{x: 1, y: 1}}>
                      <Plus color="#FFFFFF" size={18} />
                      <Text style={styles.scheduleBtnText}>Schedule Corrective Drill</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  scrollContainer: { padding: 24, paddingBottom: 60 },
  title: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', marginTop: 40, marginBottom: 28, letterSpacing: -0.5 },
  calendarStrip: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 36, gap: 8 },
  dayCard: { flex: 1, backgroundColor: 'rgba(22, 25, 46, 0.5)', borderColor: '#262940', borderWidth: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  selectedDayCard: { borderColor: 'transparent', shadowColor: '#FF453A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
  dayLabel: { color: '#8E94A8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 6, zIndex: 1 },
  selectedDayLabel: { color: 'rgba(255,255,255,0.9)' },
  dayNum: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', zIndex: 1 },
  selectedDayNum: { color: '#FFFFFF' },
  eventsSection: { gap: 16 },
  sectionHeader: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold', marginBottom: 12, letterSpacing: -0.5 },
  eventCard: { backgroundColor: 'rgba(22, 25, 46, 0.65)', borderColor: '#262940', borderWidth: 1, borderRadius: 24, padding: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', overflow: 'hidden' },
  completedEventCard: { borderColor: '#1D3B2B', backgroundColor: 'rgba(20, 32, 26, 0.4)' },
  eventInfo: { flex: 1, gap: 8, paddingRight: 16, zIndex: 1 },
  eventTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  completedText: { color: '#8E94A8', textDecorationLine: 'line-through' },
  eventTypeBadge: { color: '#FF9F0A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  eventDetailsBox: { backgroundColor: 'rgba(15, 17, 34, 0.7)', borderRadius: 12, padding: 14, marginTop: 8, gap: 6 },
  eventDetailsText: { color: '#FFFFFF', fontSize: 14 },
  eventDetailsCue: { color: '#FF9F0A', fontSize: 13, fontStyle: 'italic' },
  completionNote: { color: '#30D158', fontSize: 13, fontStyle: 'italic', marginTop: 6, fontWeight: '600' },
  checkButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.05)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.2)', zIndex: 1 },
  checkedButton: { backgroundColor: '#30D158', borderColor: '#30D158', shadowColor: '#30D158', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6 },
  emptyCheck: { width: 14, height: 14 },
  restDayCard: { backgroundColor: 'rgba(22, 25, 46, 0.5)', borderColor: '#262940', borderWidth: 1, borderRadius: 28, padding: 40, alignItems: 'center', gap: 16, overflow: 'hidden' },
  restDayTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF', zIndex: 1 },
  restDaySub: { color: '#8E94A8', fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 20, zIndex: 1 },
  scheduleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 16, shadowColor: '#FF453A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, zIndex: 1 },
  scheduleBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});
