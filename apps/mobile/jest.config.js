process.env.RNTL_SKIP_DEPS_CHECK = 'true';

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // react-native-worklets 0.10 reaches for its native module the moment it is
  // imported, which under Jest is undefined and throws on `loadUnpackers`. The
  // resolver it ships strips the `.native` extensions inside the package so the
  // plain implementation loads instead. Reanimated imports worklets, so every
  // suite that touches an animated component needs this.
  resolver: 'react-native-worklets/jest/resolver.js',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native|@lucide)',
  ],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '@react-native-async-storage/async-storage/jest/async-storage-mock',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',
    '^expo-linear-gradient$': '<rootDir>/__mocks__/expo-linear-gradient.js',
    '^expo-blur$': '<rootDir>/__mocks__/expo-blur.js',
    '.*ViewConfigIgnore.*': '<rootDir>/__mocks__/ViewConfigIgnore.js',
    '.*/lib/supabase$': '<rootDir>/__mocks__/supabase.js',
    '^expo-video$': '<rootDir>/__mocks__/expo-video.js',
    '^@react-native-community/slider$': '<rootDir>/__mocks__/slider.js',
    'vendor/thinking-orbs-native$': '<rootDir>/__mocks__/thinking-orb.js',
  },
};
