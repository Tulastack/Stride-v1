import React from 'react';
import { render } from '@testing-library/react-native';
import { CoachThinking } from '../components/CoachThinking';
import { palettes } from '../theme';

const colors = palettes.dark;

describe('CoachThinking', () => {
  it('draws every thought so far, oldest first', () => {
    const { getByText } = render(
      <CoachThinking steps={['Understanding your question', 'Checking form cues']} colors={colors} />
    );
    expect(getByText('Understanding your question')).toBeTruthy();
    expect(getByText('Checking form cues')).toBeTruthy();
  });

  it('renders nothing when there is no work to show', () => {
    const { queryByTestId } = render(<CoachThinking steps={[]} colors={colors} />);
    expect(queryByTestId('coach-thinking')).toBeNull();
  });
});
