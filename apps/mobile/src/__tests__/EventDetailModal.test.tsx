import React from 'react';
import { render } from '@testing-library/react-native';
import { EventDetailModal } from '../components/EventDetailModal';
import { palettes } from '../theme';

const colors = palettes.dark;
const TODAY = '2026-09-08';

const event = (scheduled_date: string) => ({
  id: 'evt-1',
  title: 'Wall drives',
  event_type: 'drill',
  scheduled_date,
  details: { sets: 3, reps: 8 },
});

describe('EventDetailModal', () => {
  it('offers exactly one way to dismiss, and it is the button', () => {
    const { getByTestId, queryAllByTestId } = render(
      <EventDetailModal event={event(TODAY)} colors={colors} today={TODAY} onClose={jest.fn()} onComplete={jest.fn()} />
    );
    expect(getByTestId('event-detail-close')).toBeTruthy();
    expect(queryAllByTestId('event-detail-close')).toHaveLength(1);
  });

  it("won't let a day that hasn't happened be marked complete", () => {
    const { queryByTestId, getByText } = render(
      <EventDetailModal
        event={event('2026-09-20')}
        colors={colors}
        today={TODAY}
        onClose={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(queryByTestId('event-detail-complete')).toBeNull();
    expect(getByText(/hasn't come round yet/)).toBeTruthy();
  });

  it('lets a past day be logged, and says plainly it will not restore the streak', () => {
    const { getByTestId, getByText } = render(
      <EventDetailModal
        event={event('2026-09-01')}
        colors={colors}
        today={TODAY}
        onClose={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(getByTestId('event-detail-complete')).toBeTruthy();
    expect(getByText(/won't bring back the streak/)).toBeTruthy();
  });

  it('lets today be completed with no caveat', () => {
    const { getByTestId, queryByText } = render(
      <EventDetailModal event={event(TODAY)} colors={colors} today={TODAY} onClose={jest.fn()} onComplete={jest.fn()} />
    );
    expect(getByTestId('event-detail-complete')).toBeTruthy();
    expect(queryByText(/streak/)).toBeNull();
  });
});
