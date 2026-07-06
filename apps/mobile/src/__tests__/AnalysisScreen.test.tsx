/**
 * Analysis Screen tests — simplified to match the overhauled UI.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ analysisId: 'test-1' }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../store/useStrideStore', () => ({
  useStrideStore: (selector: any) => selector({ token: 't', apiBaseUrl: 'http://localhost' }),
}));

jest.mock('../components/analysis/PoseVideoPlayer', () => ({
  PoseVideoPlayer: () => null,
}));

const mockGetAnalysis = jest.fn();
jest.mock('../services/api', () => ({
  strideApi: {
    getAnalysis: (...args: unknown[]) => mockGetAnalysis(...args),
    videoFileUrl: async () => 'http://test/video.mp4',
  },
}));

jest.mock('../lib/analysisApi', () => ({
  parseAnalysisResult: (row: any) => row.result_json,
  waitForAnalysisResult: jest.fn(),
}));

import AnalysisScreen from '../../app/(tabs)/analysis';

describe('AnalysisScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetAnalysis.mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText } = render(<AnalysisScreen />);
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('shows failure state when analysis fails', async () => {
    mockGetAnalysis.mockResolvedValue({ id: 'test-1', status: 'failed', error_message: 'Something broke' });
    const { getByText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByText('Analysis Failed')).toBeTruthy());
  });

  it('shows failure when result_json is null', async () => {
    mockGetAnalysis.mockResolvedValue({ id: 'test-1', status: 'completed', result_json: null });
    const { getByText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByText('Analysis Failed')).toBeTruthy());
  });

  it('shows failure on network error', async () => {
    mockGetAnalysis.mockRejectedValue(new Error('network'));
    const { getByText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByText('Analysis Failed')).toBeTruthy());
  });

  it('renders results when analysis completes', async () => {
    mockGetAnalysis.mockResolvedValue({
      id: 'test-1',
      status: 'completed',
      result_json: {
        id: 'test-1',
        summary: 'Your form looks good overall.',
        flaws: [
          { id: 'low_knee_drive', name: 'low knee drive', phase: 'max_velocity', severity: 4, plainExplanation: 'Knee not driving high enough.', evidence: {} },
        ],
        recommendations: [
          { flawId: 'low_knee_drive', drillId: 'a_skips', drillName: 'A-Skips', cue: 'Drive knee high', demoAssetId: '', sets: 3, reps: 20, rationale: '' },
        ],
        metrics: [],
        captureQuality: { overall: 80, fps: 30, motionBlur: 'low', framing: 'full', perMetricUsable: {} },
      },
    });
    const { getByText } = render(<AnalysisScreen />);
    await waitFor(() => expect(getByText('FORM SCORE')).toBeTruthy());
    expect(getByText('Your form looks good overall.')).toBeTruthy();
    expect(getByText('AREAS TO IMPROVE')).toBeTruthy();
    expect(getByText('low knee drive')).toBeTruthy();
    expect(getByText('A-Skips')).toBeTruthy();
    expect(getByText('Want personalized tips?')).toBeTruthy();
  });
});
