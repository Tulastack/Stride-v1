import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { strideApi } from '../services/api';
import { todayKey, addDaysToKey } from '../lib/dates';
import CalendarScreen from '../../app/(tabs)/calendar';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('../services/api', () => ({
  strideApi: { listEvents: jest.fn(), getStreak: jest.fn(), listUnrevealedEvents: jest.fn(), updateEvent: jest.fn() },
}));
const api = strideApi as jest.Mocked<typeof strideApi>;
const session = { id: 'session', title: 'Wall drives', event_type: 'drill', scheduled_date: todayKey(), status: 'scheduled', details: { sets: 3, reps: 8, cue: 'Push the ground back' } };

describe('Today-first training plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.listEvents.mockResolvedValue([session]);
    api.getStreak.mockResolvedValue({ current: 2, longest: 4, activeDates: [], lastActiveDate: null, streakStart: null, streakEnd: null, atRiskToday: false });
    api.listUnrevealedEvents.mockResolvedValue([]);
    api.updateEvent.mockResolvedValue({ ...session, status: 'completed' });
  });
  it('shows an honest first-plan state instead of calling missing work a rest day', async () => {
    api.listEvents.mockResolvedValue([]);
    const { getByText, queryByText } = render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Your plan starts here.')).toBeTruthy());
    expect(queryByText('Rest Day')).toBeNull();
    expect(getByText('Build a plan with your coach')).toBeTruthy();
  });
  it('makes today the focal point and the month optional', async () => {
    const { getByText, getByTestId } = render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wall drives')).toBeTruthy());
    expect(getByTestId('session-session')).toBeTruthy();
    expect(getByText('View monthly calendar')).toBeTruthy();
  });
  it('confirms completion with the server before changing the session', async () => {
    const { getByTestId, getByText } = render(<CalendarScreen />);
    await waitFor(() => expect(getByTestId('session-session')).toBeTruthy());
    fireEvent.press(getByTestId('session-session'));
    fireEvent.press(getByTestId('event-detail-complete'));
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledWith('session', { status: 'completed', today: todayKey() }));
    await waitFor(() => expect(getByText('Completed / 1')).toBeTruthy());
    expect(api.getStreak).toHaveBeenCalledTimes(2);
  });
  it('keeps failed completions scheduled and exposes recovery', async () => {
    api.updateEvent.mockRejectedValue(new Error('offline'));
    const { getByTestId, getByText, queryByText } = render(<CalendarScreen />);
    await waitFor(() => expect(getByTestId('session-session')).toBeTruthy());
    fireEvent.press(getByTestId('session-session'));
    fireEvent.press(getByTestId('event-detail-complete'));
    await waitFor(() => expect(getByText(/Could not confirm the update/)).toBeTruthy());
    expect(queryByText('Completed / 1')).toBeNull();
    expect(getByTestId('event-detail-complete')).toBeTruthy();
  });
  it('does not display fake emptiness or streaks after a loading failure', async () => {
    api.listEvents.mockRejectedValue(new Error('offline'));
    const { getByText, queryByText, queryByTestId } = render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Refresh plan')).toBeTruthy());
    expect(queryByText('Your plan starts here.')).toBeNull();
    expect(queryByTestId('streak-badge')).toBeNull();
    expect(queryByTestId('calendar-streak-summary')).toBeNull();
  });
  it('keeps adherence inside the calendar and connects actual streak dates in both views', async () => {
    const today = todayKey();
    api.getStreak.mockResolvedValue({ current: 2, longest: 4, activeDates: [addDaysToKey(today, -1), today], lastActiveDate: today, streakStart: addDaysToKey(today, -1), streakEnd: today, atRiskToday: false });
    const { getByTestId, getByText, queryByTestId, getAllByTestId } = render(<CalendarScreen />);
    await waitFor(() => expect(getByText('2-day streak')).toBeTruthy());
    expect(getByTestId('calendar-streak-summary')).toBeTruthy();
    expect(getByText('Best 4 days')).toBeTruthy();
    expect(getAllByTestId(/streak-ribbon-/).length).toBeGreaterThan(0);
    expect(getByTestId(`calendar-date-${today}`).props.accessibilityLabel).toContain('completed training');
    expect(queryByTestId('streak-badge')).toBeNull();
    fireEvent.press(getByText('View monthly calendar'));
    expect(getByTestId('streak-calendar')).toBeTruthy();
    expect(getAllByTestId(/streak-ribbon-/).length).toBeGreaterThan(0);
  });
});
