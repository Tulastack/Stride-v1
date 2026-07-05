/**
 * PROMPT F.3 / F.4 — confidence-aware Analysis Result screen.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ analysisId: 'headon-1' }),
  router: { push: jest.fn() },
}));

jest.mock('../store/useStrideStore', () => ({
  useStrideStore: (selector: any) => selector({ token: 't', apiBaseUrl: 'http://localhost' }),
}));

const mockGetAnalysis = jest.fn();
jest.mock('../services/api', () => ({
  strideApi: {
    getAnalysis: (...args: unknown[]) => mockGetAnalysis(...args),
    videoFileUrl: async () => 'http://test/video.mp4',
    getOverlay: async () => ({ fps: 15, width: 9, height: 16, frames: [] }),
  },
}));

import AnalysisScreen from '../../app/(tabs)/analysis';
import { lowQualityHeadOnResult, highQualitySideResult } from '../fixtures/analysisResult';

describe('AnalysisScreen (F.3 confidence-aware)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAnalysis.mockResolvedValue({
      id: 'headon-1',
      status: 'completed',
      result_json: lowQualityHeadOnResult,
    });
  });

  it('renders the report from result_json on the API row', async () => {
    const { getByText, getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByText('Biomechanics Report')).toBeTruthy());
    expect(getByLabelText('analysis-summary')).toBeTruthy();
    // (the static skeleton evidence-anchor was replaced by the scrubbable
    //  PoseVideoPlayer, which loads video/overlay asynchronously)
  });

  it('shows a capture nudge for the low-quality head-on result', async () => {
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByLabelText('capture-nudge')).toBeTruthy());
  });

  it('demotes the low-confidence hip metric (labeled, not hidden)', async () => {
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByLabelText('metric-hip_extension-lowconf')).toBeTruthy());
  });

  it('"Show the numbers" drawer toggles the measured + normal bands', async () => {
    const { getByTestId, queryByTestId } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByTestId('show-numbers-flaw-hip-ext')).toBeTruthy());
    fireEvent.press(getByTestId('show-numbers-flaw-hip-ext'));
    await waitFor(() => expect(getByTestId('numbers-flaw-hip-ext')).toBeTruthy());
  });

  it('high-quality result hides the nudge', async () => {
    mockGetAnalysis.mockResolvedValue({
      id: 'side-1',
      status: 'completed',
      result_json: highQualitySideResult,
    });
    const { getByLabelText, queryByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByLabelText('capture-good')).toBeTruthy());
    expect(queryByLabelText('capture-nudge')).toBeNull();
  });

  it('shows failure state when result_json is invalid', async () => {
    mockGetAnalysis.mockResolvedValue({ id: 'x', status: 'completed', result_json: null });
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByLabelText('analysis-failed')).toBeTruthy());
  });

  it('shows failure state on network error', async () => {
    mockGetAnalysis.mockRejectedValue(new Error('network'));
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByLabelText('analysis-failed')).toBeTruthy());
  });

  it('has NO chat affordance (vision retention)', async () => {
    const { queryByText } = render(<AnalysisScreen />);
    await waitFor(() => expect(queryByText('Biomechanics Report')).toBeTruthy());
    expect(queryByText(/message|chat/i)).toBeNull();
  });
});
