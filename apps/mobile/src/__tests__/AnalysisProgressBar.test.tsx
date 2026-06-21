import React from 'react';
import { render } from '@testing-library/react-native';
import { AnalysisProgressBar } from '../components/AnalysisProgressBar';

describe('AnalysisProgressBar', () => {
  it('renders the current stage label', () => {
    const { getByTestId } = render(<AnalysisProgressBar currentStage="pose_extraction" pct={40} />);
    expect(getByTestId('progress-stage-label')).toBeTruthy();
  });

  it('renders with testID analysis-progress-bar', () => {
    const { getByTestId } = render(<AnalysisProgressBar currentStage="queued" pct={5} />);
    expect(getByTestId('analysis-progress-bar')).toBeTruthy();
  });

  it('shows Extracting Pose for pose_extraction stage', () => {
    const { getByText } = render(<AnalysisProgressBar currentStage="pose_extraction" pct={40} />);
    expect(getByText('Extracting Pose')).toBeTruthy();
  });
});
