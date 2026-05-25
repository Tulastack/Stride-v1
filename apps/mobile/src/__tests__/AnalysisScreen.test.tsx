import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockSetIsInjured = jest.fn();

jest.mock('../store/useStrideStore', () => ({
  useStrideStore: (selector: any) => {
    const state = {
      token: 'mock-token',
      apiBaseUrl: 'http://localhost:3000',
      setIsInjured: mockSetIsInjured,
    };
    return selector(state);
  },
}));

const mockAnalysis = {
  id: 'analysis-1',
  status: 'completed',
  overall_score: 88,
  result_json: {
    overall_score: 88,
    score_label: 'Outstanding acceleration phase.',
    movenet_version: 'singlepose-thunder-v4',
    primary_issues: [
      {
        rank: 1,
        type: 'low_knee_drive',
        severity: 'medium',
        measured_value: '82.5°',
        optimal_range: '90–95°',
        plain_english: 'Your lead thigh is dropping early.',
        timeline: '2-3 weeks',
        drills: [
          { name: 'A-Skips', volume: '3 sets of 20 meters', cue: 'Punch foot down directly under hip' },
        ],
      },
    ],
  },
};

jest.mock('../services/api', () => ({
  strideApi: {
    getAnalysis: jest.fn().mockResolvedValue(mockAnalysis),
    listAnalyses: jest.fn().mockResolvedValue([{ id: 'analysis-1' }]),
  },
}));

import AnalysisScreen from '../../app/(tabs)/analysis';

describe('AnalysisScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { strideApi } = require('../services/api');
    strideApi.getAnalysis.mockResolvedValue(mockAnalysis);
    strideApi.listAnalyses.mockResolvedValue([{ id: 'analysis-1' }]);
  });

  it('renders without throwing', () => {
    const { toJSON } = render(<AnalysisScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the Biomechanics Report title after data loads', async () => {
    const { getByText } = render(<AnalysisScreen />);
    await waitFor(() => {
      expect(getByText('Biomechanics Report')).toBeTruthy();
    });
  });

  it('renders the disclaimer with correct accessibility label', async () => {
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => {
      const disclaimer = getByLabelText('analysis-disclaimer');
      expect(disclaimer).toBeTruthy();
    });
  });

  it('renders the injury toggle button', async () => {
    const { getByLabelText } = render(<AnalysisScreen />);
    await waitFor(() => {
      const toggle = getByLabelText('injury-toggle');
      expect(toggle).toBeTruthy();
    });
  });

  it('shows recovery-mode-notice when injury toggle is pressed', async () => {
    const { getByLabelText, queryByLabelText } = render(<AnalysisScreen />);

    // Wait for the analysis to load and injury toggle to appear
    await waitFor(() => {
      expect(getByLabelText('injury-toggle')).toBeTruthy();
    });

    // Initially no recovery notice
    expect(queryByLabelText('recovery-mode-notice')).toBeNull();

    // Press injury toggle
    fireEvent.press(getByLabelText('injury-toggle'));

    await waitFor(() => {
      expect(getByLabelText('recovery-mode-notice')).toBeTruthy();
    });
  });
});
