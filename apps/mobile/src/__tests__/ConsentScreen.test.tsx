import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock the store
jest.mock('../store/useStrideStore', () => ({
  useStrideStore: (selector: any) => {
    const state = {
      setConsentGiven: jest.fn(),
      setDrillIntensityCap: jest.fn(),
      token: 'mock-token',
      apiBaseUrl: 'http://localhost:3000',
    };
    return selector(state);
  },
}));

// Mock the API service
jest.mock('../services/api', () => ({
  strideApi: {
    giveConsent: jest.fn().mockResolvedValue({
      id: 'user-1',
      consent_version: 1,
      drill_intensity_cap: 'full',
    }),
  },
}));

import ConsentScreen from '../../app/(onboarding)/consent';

describe('ConsentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without throwing', () => {
    const { getByTestId } = render(<ConsentScreen />);
    expect(getByTestId('terms-checkbox')).toBeTruthy();
    expect(getByTestId('medical-checkbox')).toBeTruthy();
    expect(getByTestId('consent-continue-btn')).toBeTruthy();
  });

  it('continue button is disabled when neither checkbox is checked', () => {
    const { getByTestId } = render(<ConsentScreen />);
    const continueBtn = getByTestId('consent-continue-btn');
    // The button should be non-interactive (disabled) - pressing should have no effect
    fireEvent.press(continueBtn);
    // API should not be called
    const { strideApi } = require('../services/api');
    expect(strideApi.giveConsent).not.toHaveBeenCalled();
  });

  it('continue button is disabled when only terms checkbox is checked', () => {
    const { getByTestId } = render(<ConsentScreen />);
    fireEvent.press(getByTestId('terms-checkbox'));
    fireEvent.press(getByTestId('consent-continue-btn'));
    const { strideApi } = require('../services/api');
    expect(strideApi.giveConsent).not.toHaveBeenCalled();
  });

  it('continue button is disabled when only medical checkbox is checked', () => {
    const { getByTestId } = render(<ConsentScreen />);
    fireEvent.press(getByTestId('medical-checkbox'));
    fireEvent.press(getByTestId('consent-continue-btn'));
    const { strideApi } = require('../services/api');
    expect(strideApi.giveConsent).not.toHaveBeenCalled();
  });

  it('calls giveConsent when both checkboxes are checked and continue is pressed', async () => {
    const { getByTestId } = render(<ConsentScreen />);
    fireEvent.press(getByTestId('terms-checkbox'));
    fireEvent.press(getByTestId('medical-checkbox'));
    fireEvent.press(getByTestId('consent-continue-btn'));

    const { strideApi } = require('../services/api');
    await waitFor(() => {
      expect(strideApi.giveConsent).toHaveBeenCalledWith(
        expect.objectContaining({ consent_version: 1 })
      );
    });
  });

  it('shows parental consent checkbox when minor toggle is enabled', () => {
    const { getByTestId, queryByTestId } = render(<ConsentScreen />);
    // Initially parental checkbox not visible
    expect(queryByTestId('parental-consent-checkbox')).toBeNull();
    // Toggle minor
    fireEvent.press(getByTestId('minor-toggle'));
    expect(getByTestId('parental-consent-checkbox')).toBeTruthy();
  });

  it('shows error when minor tries to proceed without parental consent', async () => {
    const { getByTestId, getByText } = render(<ConsentScreen />);
    fireEvent.press(getByTestId('terms-checkbox'));
    fireEvent.press(getByTestId('medical-checkbox'));
    fireEvent.press(getByTestId('minor-toggle'));
    // Do NOT check parental consent
    fireEvent.press(getByTestId('consent-continue-btn'));
    await waitFor(() => {
      expect(getByText('Parental consent is required for users under 18')).toBeTruthy();
    });
  });
});
