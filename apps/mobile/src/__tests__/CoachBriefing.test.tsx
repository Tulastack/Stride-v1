/**
 * Coach screen — AI chat coach (reconciled with current UI).
 * Product moved from structured briefing to grounded chat; assert chat affordances.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));

jest.mock('../lib/analysisApi', () => ({
  fetchAnalysisHistory: jest.fn(async () => []),
}));

jest.mock('../services/api', () => ({
  strideApi: {
    createCoachSession: jest.fn(),
    askCoach: jest.fn(),
  },
}));

jest.mock('../lib/supabase', () => ({
  getAccessToken: jest.fn(async () => 'test-token'),
}));

import CoachScreen from '../../app/(tabs)/coach';

describe('CoachScreen = AI Coach chat', () => {
  it('renders the coach header and suggestion chips', async () => {
    const { getByText } = render(<CoachScreen />);
    await waitFor(() => expect(getByText('AI COACH')).toBeTruthy());
    expect(getByText('What should I fix first?')).toBeTruthy();
    expect(getByText('Create a 2-week plan')).toBeTruthy();
  });

  it('exposes a chat input for free-form questions', () => {
    const { getByPlaceholderText, UNSAFE_queryAllByType } = render(<CoachScreen />);
    expect(getByPlaceholderText(/ask your coach/i)).toBeTruthy();
    const { TextInput } = require('react-native');
    expect(UNSAFE_queryAllByType(TextInput).length).toBeGreaterThan(0);
  });

  it('has no structured briefing sections (chat replaced briefing)', () => {
    const { queryByText } = render(<CoachScreen />);
    expect(queryByText('Coach Briefing')).toBeNull();
    expect(queryByText('SINCE LAST UPLOAD')).toBeNull();
    expect(queryByText("THIS WEEK'S FOCUS")).toBeNull();
  });
});
