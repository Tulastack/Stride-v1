const React = require('react');
const { View } = require('react-native');
module.exports = {
  useVideoPlayer: () => ({ play() {}, pause() {}, currentTime: 0, duration: 0, playing: false, loop: false, muted: false }),
  VideoView: (props) => React.createElement(View, props, props.children),
};
