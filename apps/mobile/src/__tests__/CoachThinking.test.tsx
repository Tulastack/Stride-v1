import React from 'react';
import { render } from '@testing-library/react-native';
import { CoachThinking } from '../components/CoachThinking';
import { palettes } from '../theme';

const colors = palettes.dark;

describe('CoachThinking', () => {
  it('shows a truthful request status without invented reasoning stages', () => {
    const { getByText, getByLabelText } = render(
      <CoachThinking steps={['Waiting for your coach']} colors={colors} />
    );
    expect(getByText('Waiting for your coach')).toBeTruthy();
    expect(getByLabelText('Waiting for coach response')).toBeTruthy();
  });

  it('renders nothing when there is no work to show', () => {
    const { queryByTestId } = render(<CoachThinking steps={[]} colors={colors} />);
    expect(queryByTestId('coach-thinking')).toBeNull();
  });
});
