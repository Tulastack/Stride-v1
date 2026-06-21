/**
 * PROMPT F.6 — Progress timeline + re-test loop.
 * E2E-ish: two uploads -> trend chart shows points; compare-to-first toggles a
 * computed delta; the re-test CTA is present.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), router: { push: jest.fn() } }));

jest.mock('../lib/analysisApi', () => ({
  fetchAnalysisHistory: jest.fn(),
}));

import ProgressScreen from '../../app/(tabs)/progress';
import { fetchAnalysisHistory } from '../lib/analysisApi';
import { historyFixture } from '../fixtures/history';

const mockFetch = fetchAnalysisHistory as jest.MockedFunction<typeof fetchAnalysisHistory>;

describe('ProgressScreen (F.6)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(historyFixture);
  });
  it('renders a per-metric trend chart for the history', async () => {
    const { getByLabelText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByLabelText('trend-knee_drive')).toBeTruthy());
  });

  it('compare-to-first toggle reveals a computed baseline delta', async () => {
    const { getByTestId, queryByLabelText, getByLabelText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByLabelText('trend-knee_drive')).toBeTruthy());
    expect(queryByLabelText('baseline-knee_drive')).toBeNull();
    fireEvent.press(getByTestId('compare-first-toggle'));
    await waitFor(() => expect(getByLabelText('baseline-knee_drive')).toBeTruthy());
    expect(getByLabelText('baseline-knee_drive').props.children).toMatch(/vs first upload/i);
  });

  it('shows the re-test CTA (between-analyses loop)', async () => {
    const { getByLabelText } = render(<ProgressScreen />);
    await waitFor(() => expect(getByLabelText('retest-cta')).toBeTruthy());
  });
});
