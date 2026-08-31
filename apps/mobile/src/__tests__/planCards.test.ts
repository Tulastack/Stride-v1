/**
 * Grouping rules behind the Plan tab's reveal: a flat list of newly-scheduled
 * events becomes one card per training day.
 */
import {
  groupIntoDayCards,
  focusLabel,
  dominantType,
  volumeLabel,
  type CalendarEvent,
} from '../lib/planCards';

const event = (over: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  title: 'Wall drive',
  event_type: 'drill',
  scheduled_date: '2026-09-01',
  status: 'scheduled',
  ...over,
});

describe('groupIntoDayCards', () => {
  it('makes one card per day and orders them chronologically', () => {
    const cards = groupIntoDayCards([
      event({ id: 'c', scheduled_date: '2026-09-03' }),
      event({ id: 'a', scheduled_date: '2026-09-01' }),
      event({ id: 'b', scheduled_date: '2026-09-01' }),
    ]);

    expect(cards.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-03']);
    expect(cards[0]!.events).toHaveLength(2);
    expect(cards[0]!.eventIds).toEqual(['a', 'b']);
  });

  it('labels each card with a local weekday and date', () => {
    // 2026-09-01 is a Tuesday.
    const [card] = groupIntoDayCards([event({ id: 'a', scheduled_date: '2026-09-01' })]);
    expect(card!.weekday).toBe('TUE');
    expect(card!.dateLabel).toBe('SEP 1');
  });

  it('returns nothing for an empty plan', () => {
    expect(groupIntoDayCards([])).toEqual([]);
  });
});

describe('focusLabel', () => {
  it('names a single-session day after the session itself', () => {
    expect(focusLabel([event({ id: 'a', title: 'Hip hitch' })])).toBe('Hip hitch');
  });

  it('collapses repeats of the same session to that one name', () => {
    expect(
      focusLabel([event({ id: 'a', title: 'Hip hitch' }), event({ id: 'b', title: 'Hip hitch' })]),
    ).toBe('Hip hitch');
  });

  it('falls back to the category on a mixed day', () => {
    expect(
      focusLabel([
        event({ id: 'a', title: 'Hip hitch', event_type: 'drill' }),
        event({ id: 'b', title: 'Tempo run', event_type: 'workout' }),
      ]),
    ).toBe('Workout');
  });
});

describe('dominantType', () => {
  it('lets a race outrank everything else on the day', () => {
    expect(
      dominantType([
        event({ id: 'a', event_type: 'drill' }),
        event({ id: 'b', event_type: 'competition' }),
        event({ id: 'c', event_type: 'workout' }),
      ]),
    ).toBe('competition');
  });

  it('only calls a day a rest day when it holds nothing else', () => {
    expect(dominantType([event({ id: 'a', event_type: 'rest' })])).toBe('rest');
    expect(
      dominantType([event({ id: 'a', event_type: 'rest' }), event({ id: 'b', event_type: 'drill' })]),
    ).toBe('drill');
  });
});

describe('volumeLabel', () => {
  it('prefers structured sets and reps', () => {
    expect(volumeLabel(event({ id: 'a', details: { sets: 3, reps: 10, volume: '20min' } }))).toBe('3 × 10');
  });

  it('falls back to free-form volume', () => {
    expect(volumeLabel(event({ id: 'a', details: { volume: '400m × 4' } }))).toBe('400m × 4');
  });

  it('returns null when the event carries neither', () => {
    expect(volumeLabel(event({ id: 'a' }))).toBeNull();
    expect(volumeLabel(event({ id: 'a', details: { cue: 'Stay tall' } }))).toBeNull();
  });
});
