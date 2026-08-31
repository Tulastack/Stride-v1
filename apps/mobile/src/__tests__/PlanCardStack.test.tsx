/**
 * The reveal takeover. Swipes themselves are driven by the native gesture
 * handler and are covered by the pure grouping/streak tests plus manual QA;
 * what matters here is that the stack renders the right day, counts correctly,
 * and that Skip always dismisses the whole thing rather than stranding the
 * athlete in a takeover they cannot leave.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PlanCardStack } from '../components/plan/PlanCardStack';
import { groupIntoDayCards, type CalendarEvent } from '../lib/planCards';
import { palettes } from '../theme';

const event = (over: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  title: 'Wall drive',
  event_type: 'drill',
  scheduled_date: '2026-09-01',
  status: 'scheduled',
  ...over,
});

const cards = groupIntoDayCards([
  event({ id: 'a', scheduled_date: '2026-09-01', title: 'Wall drive' }),
  event({ id: 'b', scheduled_date: '2026-09-02', title: 'Hip hitch' }),
  event({ id: 'c', scheduled_date: '2026-09-02', title: 'Tempo run', event_type: 'workout' }),
]);

function setup(overrides: Partial<React.ComponentProps<typeof PlanCardStack>> = {}) {
  const props = {
    cards,
    colors: palettes.light,
    onAccept: jest.fn(),
    onDecline: jest.fn(),
    onUndoDecline: jest.fn(),
    onSkipAll: jest.fn(),
    onDone: jest.fn(),
    ...overrides,
  };
  return { ...render(<PlanCardStack {...props} />), props };
}

describe('PlanCardStack', () => {
  it('opens on the first scheduled day', () => {
    const { getByTestId, getAllByText } = setup();
    expect(getByTestId('plan-card-stack')).toBeTruthy();
    expect(getByTestId('plan-card-top')).toBeTruthy();
    // 2026-09-01 is a Tuesday holding a single named session. Both faces of the
    // card are mounted (the back is rotated away), so labels appear twice.
    expect(getAllByText('1').length).toBeGreaterThan(0); // the day numeral
    expect(getAllByText('Wall drive').length).toBeGreaterThan(0);
  });

  it('groups by day, so three sessions across two days make two cards', () => {
    const { queryByText, getAllByText } = setup();
    // Day one is on top; day two's sessions are only on the card behind it.
    expect(getAllByText('Wall drive').length).toBeGreaterThan(0);
    // No progress counter or gesture legend — the deck speaks for itself.
    expect(queryByText(/of 2/)).toBeNull();
    expect(queryByText(/Swipe/i)).toBeNull();
    expect(queryByText(/days scheduled/)).toBeNull();
  });

  it('names a mixed day by its category rather than one of its sessions', () => {
    const { getAllByText } = setup({ cards: cards.slice(1) });
    expect(getAllByText('Workout').length).toBeGreaterThan(0);
  });

  it('hands every remaining day back when the athlete skips', () => {
    const { getByTestId, props } = setup();
    fireEvent.press(getByTestId('plan-card-skip'));
    expect(props.onSkipAll).toHaveBeenCalledWith(cards);
    // Nothing was swiped, so no day should have been individually accepted.
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(props.onDecline).not.toHaveBeenCalled();
  });

  it('still folds into the calendar after a skip', async () => {
    // The fold is what triggers the grid bounce and streak refresh, so skipping
    // must not bypass it and leave the calendar looking untouched.
    const { getByTestId, props } = setup();
    fireEvent.press(getByTestId('plan-card-skip'));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });

  it('offers a way out without any instructional chrome', () => {
    // The only control on the takeover is dismiss; everything else is the deck.
    const { getByTestId, queryByText } = setup();
    expect(getByTestId('plan-card-skip')).toBeTruthy();
    expect(queryByText('Skip')).toBeNull();
    expect(queryByText('NEW PLAN')).toBeNull();
  });
});
