/**
 * PROMPT F.7 — calendar approval gate (mobile).
 * E2E-ish: recommendation -> review modal -> approve -> onApprove fires;
 * decline -> no write. Building the proposal never writes.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ScheduleReviewModal } from '../components/ScheduleReviewModal';
import { generateProposal } from '../lib/proposal';
import type { DrillRec } from '../types/analysis';

const focus: DrillRec = {
  flawId: 'flaw-low-knee',
  drillId: 'high-knee-switch',
  drillName: 'High-knee wall switches',
  cue: 'Punch the knee up higher than normal.',
  demoAssetId: 'demo-high-knee-switch',
  sets: 3,
  reps: 10,
  rationale: 'Raises knee-drive height.',
};

describe('generateProposal (pure, mobile)', () => {
  it('is deterministic and writes nothing', () => {
    expect(generateProposal(focus, '2026-02-02', 3, 2)).toEqual(generateProposal(focus, '2026-02-02', 3, 2));
    expect(generateProposal(focus, '2026-02-02')).toHaveLength(3);
  });
});

describe('ScheduleReviewModal approval gate', () => {
  it('renders proposed sessions but does NOT write on open', () => {
    const onApprove = jest.fn();
    const { getByLabelText } = render(
      <ScheduleReviewModal visible focus={focus} startDate="2026-02-02" onApprove={onApprove} onClose={jest.fn()} />
    );
    expect(getByLabelText('schedule-review-modal')).toBeTruthy();
    expect(getByLabelText('proposed-high-knee-switch-0')).toBeTruthy();
    expect(onApprove).not.toHaveBeenCalled(); // opening != writing
  });

  it('writes ONLY on the explicit "Add to calendar" tap', async () => {
    const onApprove = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <ScheduleReviewModal visible focus={focus} startDate="2026-02-02" onApprove={onApprove} onClose={jest.fn()} />
    );
    fireEvent.press(getByTestId('review-approve'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    expect(onApprove.mock.calls[0][0]).toHaveLength(3);
  });

  it('declining writes nothing', () => {
    const onApprove = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <ScheduleReviewModal visible focus={focus} startDate="2026-02-02" onApprove={onApprove} onClose={onClose} />
    );
    fireEvent.press(getByTestId('review-decline'));
    expect(onApprove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('removing all sessions disables approval (nothing to write)', async () => {
    const onApprove = jest.fn();
    const { getByTestId } = render(
      <ScheduleReviewModal visible focus={focus} startDate="2026-02-02" onApprove={onApprove} onClose={jest.fn()} />
    );
    fireEvent.press(getByTestId('remove-high-knee-switch-0'));
    fireEvent.press(getByTestId('remove-high-knee-switch-1'));
    fireEvent.press(getByTestId('remove-high-knee-switch-2'));
    fireEvent.press(getByTestId('review-approve'));
    expect(onApprove).not.toHaveBeenCalled();
  });
});
