import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import LoginScreen from '../../app/(auth)/login';
import RegisterScreen from '../../app/(auth)/register';
import { supabase } from '../lib/supabase';
import { strideApi } from '../services/api';
import { useStrideStore } from '../store/useStrideStore';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() }) }));
jest.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true, supabase: { auth: { signInWithPassword: jest.fn(), signUp: jest.fn() } },
}));
jest.mock('../services/api', () => ({ strideApi: { getProfile: jest.fn() } }));
const signIn = supabase!.auth.signInWithPassword as jest.Mock;
const signUp = supabase!.auth.signUp as jest.Mock;
const profile = strideApi.getProfile as jest.Mock;
function fill(fields: ReturnType<typeof render>) {
  fireEvent.changeText(fields.getByTestId('email-input'), 'athlete@example.com');
  fireEvent.changeText(fields.getByTestId('password-input'), 'password');
}
describe('Authentication flows through the new entry UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrideStore.setState({ token: null, user: null });
    profile.mockResolvedValue({ id: 'athlete', email: 'athlete@example.com', consent_given_at: '2026-01-01', consent_version: 1 });
    signIn.mockResolvedValue({ data: { session: { access_token: 'token' }, user: { id: 'athlete' } }, error: null });
  });
  it('signs in and preserves the returning-athlete route', async () => {
    const fields = render(<LoginScreen />);
    fill(fields);
    fireEvent.press(fields.getByText('Sign in'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(useStrideStore.getState().token).toBe('token');
    expect(signIn).toHaveBeenCalledWith({ email: 'athlete@example.com', password: 'password' });
  });
  it('keeps required consent in the authenticated path', async () => {
    profile.mockResolvedValue({ id: 'athlete', consent_given_at: null });
    const fields = render(<LoginScreen />);
    fill(fields);
    fireEvent.press(fields.getByText('Sign in'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/consent'));
  });
  it('exposes auth errors without navigating or fabricating a session', async () => {
    signIn.mockResolvedValue({ data: {}, error: new Error('Invalid credentials') });
    const fields = render(<LoginScreen />);
    fill(fields);
    fireEvent.press(fields.getByText('Sign in'));
    await waitFor(() => expect(fields.getByText('Invalid credentials')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useStrideStore.getState().token).toBeNull();
  });
  it('shows an email-confirmation state without claiming the athlete is logged in', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'athlete' } }, error: null });
    const fields = render(<RegisterScreen />);
    fill(fields);
    fireEvent.press(fields.getByText('Create account'));
    await waitFor(() => expect(fields.getByText('Check your inbox.')).toBeTruthy());
    expect(profile).not.toHaveBeenCalled();
    expect(useStrideStore.getState().token).toBeNull();
    fireEvent.press(fields.getByText('Back to sign in'));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });
});
