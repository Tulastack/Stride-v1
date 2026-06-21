/**
 * PROMPT F.5 — Coach Briefing screen (structured, no chat).
 * Vision retention: NO input box, NO message bubbles; data-driven sections only.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));

jest.mock('../lib/analysisApi', () => ({
  fetchAnalysisHistory: jest.fn(),
}));

import CoachScreen from '../../app/(tabs)/coach';
import { fetchAnalysisHistory } from '../lib/analysisApi';
import { historyFixture } from '../fixtures/history';

const mockFetch = fetchAnalysisHistory as jest.MockedFunction<typeof fetchAnalysisHistory>;

describe('CoachScreen = Coach Briefing (F.5)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(historyFixture);
  });
  it('renders the structured briefing sections', async () => {
    const { getByText, getByLabelText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText('Coach Briefing')).toBeTruthy());
    expect(getByText('SINCE LAST UPLOAD')).toBeTruthy();
    expect(getByText("THIS WEEK'S FOCUS")).toBeTruthy();
    expect(getByText('YOUR TREND')).toBeTruthy();
    expect(getByText('NEXT CHECKPOINT')).toBeTruthy();
    expect(getByLabelText('briefing-focus')).toBeTruthy();
  });

  it('shows a real "since last" delta and a gated (low-confidence) delta', async () => {
    const { getByLabelText } = render(<CoachScreen />);
    await waitFor(() => expect(getByLabelText('delta-knee_drive')).toBeTruthy());
    // hip delta is gated because upload-2 hip confidence is low
    expect(getByLabelText('delta-hip_extension-gated')).toBeTruthy();
  });

  it('renders a trend chart for tracked metrics', async () => {
    const { getByLabelText } = render(<CoachScreen />);
    await waitFor(() => expect(getByLabelText('trend-knee_drive')).toBeTruthy());
  });

  it('has NO chat input or message affordance (vision retention)', () => {
    const { queryByPlaceholderText, queryByText, UNSAFE_queryAllByType } = render(<CoachScreen />);
    expect(queryByPlaceholderText(/message/i)).toBeNull();
    expect(queryByText(/message coach/i)).toBeNull();
    // No TextInput anywhere on the screen
    const { TextInput } = require('react-native');
    expect(UNSAFE_queryAllByType(TextInput).length).toBe(0);
  });
});
