const React = require('react');
const { View } = require('react-native');

function ThinkingOrb(props) {
  return React.createElement(View, {
    testID: 'thinking-orb',
    accessibilityLabel: props.accessibilityLabel || 'Coach thinking',
  });
}

module.exports = { ThinkingOrb };
