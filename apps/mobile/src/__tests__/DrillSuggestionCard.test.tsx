import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { DrillSuggestionCard } from '../components/DrillSuggestionCard';

const mockSuggestion = {
  id: 'sug-1',
  drill_key: 'a_skips',
  drill_name: 'A-Skips',
  suggested_date: '2026-06-01',
  status: 'pending' as const,
};

describe('DrillSuggestionCard', () => {
  it('renders skip and approve buttons', () => {
    const { getByTestId } = render(
      <DrillSuggestionCard suggestion={mockSuggestion} onApprove={jest.fn()} onSkip={jest.fn()} />
    );
    expect(getByTestId('skip-suggestion-sug-1')).toBeTruthy();
    expect(getByTestId('approve-suggestion-sug-1')).toBeTruthy();
  });

  it('calls onSkip when Skip is pressed', async () => {
    const onSkip = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <DrillSuggestionCard suggestion={mockSuggestion} onApprove={jest.fn()} onSkip={onSkip} />
    );
    fireEvent.press(getByTestId('skip-suggestion-sug-1'));
    await waitFor(() => expect(onSkip).toHaveBeenCalledWith('sug-1'));
  });

  it('only calls onApprove after the explicit date-confirm step (approval gate)', async () => {
    const onApprove = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <DrillSuggestionCard suggestion={mockSuggestion} onApprove={onApprove} onSkip={jest.fn()} />
    );
    // First tap opens the scheduler — nothing is committed yet.
    fireEvent.press(getByTestId('approve-suggestion-sug-1'));
    expect(onApprove).not.toHaveBeenCalled();
    // Only the explicit confirm writes.
    fireEvent.press(getByTestId('confirm-date-sug-1'));
    await waitFor(() =>
      expect(onApprove).toHaveBeenCalledWith('sug-1', expect.any(String))
    );
  });

  it('disappears when skipped', async () => {
    const onSkip = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = render(
      <DrillSuggestionCard suggestion={mockSuggestion} onApprove={jest.fn()} onSkip={onSkip} />
    );
    fireEvent.press(getByTestId('skip-suggestion-sug-1'));
    await waitFor(() => expect(queryByTestId('suggestion-card-sug-1')).toBeNull());
  });
});
