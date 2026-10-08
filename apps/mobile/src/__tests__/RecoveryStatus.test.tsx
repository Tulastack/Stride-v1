import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useRecoveryStatus } from '../hooks/useRecoveryStatus';
import { RecoveryControls } from '../components/RecoveryControls';
import { useStrideStore } from '../store/useStrideStore';
import { strideApi } from '../services/api';

jest.mock('../services/api', () => ({ strideApi: { getProfile: jest.fn(), updateInjuryStatus: jest.fn() } }));
const api = strideApi as jest.Mocked<typeof strideApi>;
function RecoveryExample() { return <RecoveryControls recovery={useRecoveryStatus()} />; }

describe('Server-confirmed recovery preference', () => {
  beforeEach(() => { jest.clearAllMocks(); useStrideStore.setState({ isInjured: false }); api.getProfile.mockResolvedValue({ is_injured: false }); });
  it('restores a saved injury preference instead of assuming training is safe', async () => {
    api.getProfile.mockResolvedValue({ is_injured: true });
    const { getByText, getByTestId } = render(<RecoveryExample />);
    await waitFor(() => expect(getByTestId('injury-toggle').props.value).toBe(true));
    expect(getByText(/Recovery Mode/)).toBeTruthy();
  });
  it('only changes the switch after server confirmation', async () => {
    api.updateInjuryStatus.mockResolvedValue({ is_injured: true });
    const { getByTestId } = render(<RecoveryExample />);
    await waitFor(() => expect(getByTestId('injury-toggle').props.disabled).toBe(false));
    fireEvent(getByTestId('injury-toggle'), 'valueChange', true);
    await waitFor(() => expect(getByTestId('injury-toggle').props.value).toBe(true));
    expect(api.updateInjuryStatus).toHaveBeenCalledWith(true);
  });
  it('locks prescriptions when the update cannot be confirmed', async () => {
    api.updateInjuryStatus.mockRejectedValue(new Error('offline'));
    const { getByTestId, getByText } = render(<RecoveryExample />);
    await waitFor(() => expect(getByTestId('injury-toggle').props.disabled).toBe(false));
    fireEvent(getByTestId('injury-toggle'), 'valueChange', true);
    await waitFor(() => expect(getByText(/Could not confirm your recovery update/)).toBeTruthy());
    expect(getByTestId('injury-toggle').props.disabled).toBe(true);
    expect(getByTestId('injury-toggle').props.value).toBe(false);
    expect(getByText('Refresh recovery preference')).toBeTruthy();
  });
});
