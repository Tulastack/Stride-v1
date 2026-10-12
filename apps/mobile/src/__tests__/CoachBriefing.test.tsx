import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const routeParams: { analysisId?: string; workflow?: string } = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParams,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    setParams: (next: { workflow?: string }) => { routeParams.workflow = next.workflow; },
  },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('../lib/analysisApi', () => ({ fetchAnalysisHistory: jest.fn() }));
jest.mock('../components/CoachChat', () => ({
  CoachChat: ({ analysisId, initialPrompt }: { analysisId?: string; initialPrompt?: string }) => {
    const { Text, TextInput } = require('react-native');
    return <><Text>{analysisId ? 'Linked to ' + analysisId : 'General advice'}</Text>{initialPrompt ? <Text>{initialPrompt}</Text> : null}<TextInput placeholder="Ask your coach..." /></>;
  },
}));

import CoachScreen from '../../app/(tabs)/coach';
import { fetchAnalysisHistory } from '../lib/analysisApi';
import { historyFixture } from '../fixtures/history';
const mockHistory = fetchAnalysisHistory as jest.MockedFunction<typeof fetchAnalysisHistory>;

describe('Contextual coaching home', () => {
  beforeEach(() => { jest.clearAllMocks(); mockHistory.mockResolvedValue([]); delete routeParams.analysisId; delete routeParams.workflow; });

  it('does not invent measurements for a new athlete', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText(/No sprint linked yet/)).toBeTruthy());
    expect(getByText('Film your first sprint')).toBeTruthy();
    expect(getByPlaceholderText(/ask your coach/i)).toBeTruthy();
    expect(getByText('General advice')).toBeTruthy();
    expect(queryByText('FROM YOUR ANALYSIS / NOT GENERAL ADVICE')).toBeNull();
  });

  it('keeps the conversation on the coach screen', async () => {
    const { getByText, getByPlaceholderText } = render(<CoachScreen />);
    await waitFor(() => expect(getByPlaceholderText(/ask your coach/i)).toBeTruthy());
    expect(getByText('General advice')).toBeTruthy();
  });

  it('ties the latest analysis to the coach without hiding the conversation', async () => {
    mockHistory.mockResolvedValue(historyFixture);
    const { getByText, getByPlaceholderText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText(/Trunk too upright/)).toBeTruthy());
    expect(getByText('Linked to upload-2')).toBeTruthy();
    expect(getByPlaceholderText(/ask your coach/i)).toBeTruthy();
    fireEvent.press(getByText('Open the source analysis'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/analysis', params: { analysisId: 'upload-2' } });
  });

  it('starts the report workflow without closing the report or the plan', async () => {
    routeParams.analysisId = 'report-9';
    routeParams.workflow = 'report';
    const { getByText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText('What should I fix first in this report, and what should I put on my plan this week?')).toBeTruthy());
    expect(getByText('Linked to report-9')).toBeTruthy();
    fireEvent.press(getByText('Report'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/analysis', params: { analysisId: 'report-9' } });
    fireEvent.press(getByText('Plan'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/calendar');
  });

  it('keeps a fetch failure distinct from a genuine empty account', async () => {
    mockHistory.mockRejectedValue(new Error('offline'));
    const { getByText, queryByText, getByPlaceholderText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText(/Could not load your latest analysis/)).toBeTruthy());
    expect(getByText('Refresh analysis')).toBeTruthy();
    expect(getByPlaceholderText(/ask your coach/i)).toBeTruthy();
    expect(queryByText(/No sprint linked yet/)).toBeNull();
  });
});
