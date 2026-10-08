import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { CoachChat } from '../components/CoachChat';
import { strideApi } from '../services/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('../services/api', () => ({
  strideApi: { createCoachSession: jest.fn(), askCoach: jest.fn(), addCoachPlanToCalendar: jest.fn() },
}));
const api = strideApi as jest.Mocked<typeof strideApi>;

describe('Coach conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.createCoachSession.mockResolvedValue({ id: 'session' });
    api.askCoach.mockResolvedValue({ role: 'assistant', content: 'Keep your training consistent.' });
    api.addCoachPlanToCalendar.mockResolvedValue({ created: 2, events: [] });
  });
  it('creates a grounded session for an analysis and retains free-form questions', async () => {
    const { getByText } = render(<CoachChat analysisId="analysis" initialPrompt="Explain my run" />);
    await waitFor(() => expect(getByText('Keep your training consistent.')).toBeTruthy());
    expect(api.createCoachSession).toHaveBeenCalledWith('analysis_workflow', 'analysis');
    expect(api.askCoach).toHaveBeenCalledWith('session', 'Explain my run', []);
  });
  it('locks input while awaiting an actual reply', async () => {
    let resolveReply: (value: any) => void = () => {};
    api.askCoach.mockReturnValue(new Promise((resolve) => { resolveReply = resolve; }));
    const { getByLabelText, getByText } = render(<CoachChat />);
    fireEvent.changeText(getByLabelText('Ask your coach'), 'How should I train?');
    fireEvent.press(getByLabelText('Send message'));
    await waitFor(() => expect(getByText('Waiting for your coach')).toBeTruthy());
    expect(getByLabelText('Ask your coach').props.editable).toBe(false);
    fireEvent.press(getByLabelText('Send message'));
    expect(api.askCoach).toHaveBeenCalledTimes(1);
    await act(async () => resolveReply({ role: 'assistant', content: 'Build gradually.' }));
    expect(getByText('Build gradually.')).toBeTruthy();
    expect(api.createCoachSession).toHaveBeenCalledWith('free_coach');
  });
  it('retries a failed question without duplicating it in request history', async () => {
    api.askCoach.mockRejectedValueOnce(new Error('offline'));
    const { getByLabelText, getByText, getAllByText } = render(<CoachChat />);
    fireEvent.changeText(getByLabelText('Ask your coach'), 'What comes next?');
    fireEvent.press(getByLabelText('Send message'));
    await waitFor(() => expect(getByText('Retry message')).toBeTruthy());
    fireEvent.press(getByText('Retry message'));
    await waitFor(() => expect(getByText('Keep your training consistent.')).toBeTruthy());
    expect(api.askCoach).toHaveBeenLastCalledWith('session', 'What comes next?', []);
    expect(getAllByText('What comes next?')).toHaveLength(1);
  });
  it('requires explicit approval before scheduling and closes the layer afterward', async () => {
    api.askCoach.mockResolvedValue({ role: 'assistant', content: 'Here is your training plan.', calendarRelevant: true });
    const onScheduled = jest.fn();
    const { getByText } = render(<CoachChat initialPrompt="Build a plan" onScheduled={onScheduled} />);
    await waitFor(() => expect(getByText('Add to My Calendar')).toBeTruthy());
    expect(api.addCoachPlanToCalendar).not.toHaveBeenCalled();
    fireEvent.press(getByText('Add to My Calendar'));
    await waitFor(() => expect(api.addCoachPlanToCalendar).toHaveBeenCalledTimes(1));
    expect(api.addCoachPlanToCalendar).toHaveBeenCalledWith('session', [
      { role: 'user', content: 'Build a plan' }, { role: 'assistant', content: 'Here is your training plan.' },
    ]);
    await waitFor(() => expect(onScheduled).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/calendar');
  });
  it('keeps scheduling failures separate from message retry', async () => {
    api.askCoach.mockResolvedValue({ role: 'assistant', content: 'Here is a plan.', calendarRelevant: true });
    api.addCoachPlanToCalendar.mockRejectedValue(new Error('offline'));
    const { getByText, queryByText } = render(<CoachChat initialPrompt="Build a plan" />);
    await waitFor(() => expect(getByText('Add to My Calendar')).toBeTruthy());
    fireEvent.press(getByText('Add to My Calendar'));
    await waitFor(() => expect(getByText('Retry scheduling')).toBeTruthy());
    expect(queryByText('Retry message')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
