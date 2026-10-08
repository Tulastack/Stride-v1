import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MetricRow } from '../components/analysis/MetricRow';
import { palettes } from '../theme';
import type { Metric } from '../types/analysis';

const metric: Metric = { key: 'knee_drive', unit: '°', measured: { value: 83, low: 81, high: 85, confidence: 0.9 }, normalRange: [80, 95], comparableAcrossViews: true, trustStatus: 'trusted' };

describe('measurement disclosure', () => {
  it('opens the uncertainty and reference ranges on demand', () => {
    const { getByTestId, getByText, queryByText } = render(<MetricRow metric={metric} />);
    expect(queryByText('UNCERTAINTY BAND')).toBeNull();
    fireEvent.press(getByTestId('metric-knee_drive'));
    expect(getByText('81–85 °')).toBeTruthy();
    expect(getByText('80–95 °')).toBeTruthy();
  });
  it('withholds unusable footage instead of showing precise values', () => {
    const { getByText, queryByText } = render(<MetricRow metric={metric} usable={false} />);
    expect(getByText('Withheld')).toBeTruthy();
    expect(queryByText('83°')).toBeNull();
  });
  it('does not elevate an experimental reading to a confirmed value', () => {
    const { getByText } = render(<MetricRow metric={{ ...metric, trustStatus: 'experimental' }} />);
    expect(getByText('Withheld')).toBeTruthy();
    expect(getByText(/experimental/)).toBeTruthy();
  });
});
