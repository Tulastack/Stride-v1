import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import SettingsScreen from '../../app/(tabs)/settings';
import { strideApi } from '../services/api';
import { supabase } from '../lib/supabase';
import { useStrideStore } from '../store/useStrideStore';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: (...args: unknown[]) => mockReplace(...args) }) }));
jest.mock('../services/api', () => ({ strideApi: { deleteAccount: jest.fn(), getProfile: jest.fn(async () => ({ is_injured: false })) } }));
jest.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
const api = strideApi as jest.Mocked<typeof strideApi>;
const signOut = supabase!.auth.signOut as jest.Mock;

describe('Account confirmations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrideStore.setState({ token: 'token', isInjured: false, user: null });
    signOut.mockResolvedValue({ error: null });
    api.deleteAccount.mockResolvedValue({ ok: true });
  });
  it('does not delete until the explicit irreversible confirmation', async () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    await waitFor(() => expect(getByLabelText('I am injured today').props.disabled).toBe(false));
    fireEvent.press(getByText('Delete Account'));
    expect(api.deleteAccount).not.toHaveBeenCalled();
    fireEvent.press(getByText('Keep my account'));
    expect(api.deleteAccount).not.toHaveBeenCalled();
    expect(useStrideStore.getState().token).toBe('token');
  });
  it('retains the account on deletion failure', async () => {
    api.deleteAccount.mockRejectedValue(new Error('Could not delete the account'));
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete Account'));
    fireEvent.press(getByText('Permanently delete account'));
    await waitFor(() => expect(getByText('Could not delete the account')).toBeTruthy());
    expect(useStrideStore.getState().token).toBe('token');
    expect(signOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
  it('clears local identity after deletion even if the remote session cannot be revoked', async () => {
    signOut.mockRejectedValue(new Error('session offline'));
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete Account'));
    fireEvent.press(getByText('Permanently delete account'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
    expect(api.deleteAccount).toHaveBeenCalledTimes(1);
    expect(useStrideStore.getState().token).toBeNull();
  });
  it('does not claim a failed sign-out succeeded', async () => {
    signOut.mockResolvedValue({ error: new Error('Could not sign out') });
    const { getByLabelText, getByText, getByTestId } = render(<SettingsScreen />);
    await waitFor(() => expect(getByLabelText('I am injured today').props.disabled).toBe(false));
    fireEvent.press(getByLabelText('Sign out'));
    fireEvent.press(within(getByTestId('account-confirmation')).getByLabelText('Sign out'));
    await waitFor(() => expect(getByText('Could not sign out')).toBeTruthy());
    expect(useStrideStore.getState().token).toBe('token');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
