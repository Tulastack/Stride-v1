module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 runs its animation callbacks as worklets on the UI thread.
    // This plugin does that transform and MUST stay last in the list.
    plugins: ['react-native-worklets/plugin'],
  };
};
