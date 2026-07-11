/**
 * Progress timeline — score log + re-test loop (reconciled with current UI).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
  router: { push: jest.fn() },
}));

jest.mock('../lib/analysisApi', () => ({
  fetchAnalysisHistory: jest.fn(),
}));

import ProgressScreen from '../../app/(tabs)/progress';
import { fetchAnalysisHistory } from '../lib/analysisApi';
import { historyFixture } from '../fixtures/history';

const mockFetch = fetchAnalysisHistory as jest.MockedFunction<typeof fetchAnalysisHistory>;

describe('ProgressScreen', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(historyFixture);
  });

  it('renders the history score log from fixture uploads', async () => {
    const { getByText, getByLabelText, getAllByText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByText(/2 sprints analyzed/i)).toBeTruthy());
    expect(getByLabelText('progress-log-upload-1')).toBeTruthy();
    expect(getByLabelText('progress-log-upload-2')).toBeTruthy();
    expect(getAllByText(/issue/i).length).toBeGreaterThan(0);
  });

  it('opens a score breakdown when a log card is pressed', async () => {
    const { getByLabelText, getByText, getAllByText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByLabelText('progress-log-upload-1')).toBeTruthy());
    fireEvent.press(getByLabelText('progress-log-upload-1'));
    await waitFor(() => expect(getByText('SCORE BREAKDOWN')).toBeTruthy());
    expect(getAllByText(/Low knee drive/i).length).toBeGreaterThan(0);
  });

  it('shows the re-test CTA (between-analyses loop)', async () => {
    const { getByLabelText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByLabelText('retest-cta')).toBeTruthy());
  });
});
