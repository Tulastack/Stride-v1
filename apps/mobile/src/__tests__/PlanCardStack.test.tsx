import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PlanCardStack } from '../components/plan/PlanCardStack';
import { groupIntoDayCards, type CalendarEvent } from '../lib/planCards';
import { palettes } from '../theme';

const event = (overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  title: 'Wall drive', event_type: 'drill', scheduled_date: '2026-09-01', status: 'scheduled', ...overrides,
});
const cards = groupIntoDayCards([
  event({ id: 'first', title: 'Wall drive' }),
  event({ id: 'second', scheduled_date: '2026-09-02', title: 'Hip hitch' }),
  event({ id: 'third', scheduled_date: '2026-09-02', title: 'Tempo run', event_type: 'workout' }),
]);
function setup(overrides: Partial<React.ComponentProps<typeof PlanCardStack>> = {}) {
  const props = { cards, colors: palettes.light, onAccept: jest.fn(), onSkipAll: jest.fn(), onDone: jest.fn(), ...overrides };
  return { ...render(<PlanCardStack {...props} />), props };
}

describe('Accessible chronological plan review', () => {
  it('opens with one day, its real sessions, and explicit controls', () => {
    const { getByText, getAllByText, queryByText, getByTestId } = setup();
    expect(getByTestId('plan-card-stack')).toBeTruthy();
    expect(getAllByText('Wall drive').length).toBeGreaterThan(0);
    expect(queryByText('Hip hitch')).toBeNull();
    expect(getByText('Next day')).toBeTruthy();
    expect(getByText('View in my plan')).toBeTruthy();
    expect(getByText('Review later')).toBeTruthy();
  });
  it('advances only after the current review is confirmed', async () => {
    let resolveReview: () => void = () => {};
    const pending = new Promise<void>((resolve) => { resolveReview = resolve; });
    const { getByText, queryByText, props } = setup({ onAccept: jest.fn(() => pending) });
    fireEvent.press(getByText('Next day'));
    expect(props.onAccept).toHaveBeenCalledWith(cards[0]);
    expect(queryByText('Hip hitch')).toBeNull();
    resolveReview();
    await waitFor(() => expect(getByText('Hip hitch')).toBeTruthy());
    expect(getByText('Workout')).toBeTruthy();
    expect(getByText('Tempo run')).toBeTruthy();
  });
  it('confirms every remaining day when opening the plan', async () => {
    const { getByText, props } = setup();
    fireEvent.press(getByText('View in my plan'));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    expect(props.onAccept).toHaveBeenCalledTimes(2);
  });
  it('preserves the day and offers retry when review fails', async () => {
    const { getByText, getAllByText, props } = setup({ onAccept: jest.fn().mockRejectedValue(new Error('offline')) });
    fireEvent.press(getByText('Next day'));
    await waitFor(() => expect(getByText(/Could not save your review/)).toBeTruthy());
    expect(getAllByText('Wall drive').length).toBeGreaterThan(0);
    expect(props.onDone).not.toHaveBeenCalled();
  });
  it('lets the athlete review later without unscheduling their work', async () => {
    const { getByTestId, props } = setup();
    fireEvent.press(getByTestId('plan-card-skip'));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    expect(props.onSkipAll).toHaveBeenCalledWith(cards);
    expect(props.onAccept).not.toHaveBeenCalled();
  });
  it('allows long session lists to scroll', () => {
    const { getByTestId } = setup();
    expect(getByTestId('day-card-sessions')).toBeTruthy();
  });
});
