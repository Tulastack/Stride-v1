process.env.RNTL_SKIP_DEPS_CHECK = 'true';

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native|@lucide)',
  ],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',
    '^expo-linear-gradient$': '<rootDir>/__mocks__/expo-linear-gradient.js',
    '^expo-blur$': '<rootDir>/__mocks__/expo-blur.js',
    '.*ViewConfigIgnore.*': '<rootDir>/__mocks__/ViewConfigIgnore.js',
    '.*/lib/supabase$': '<rootDir>/__mocks__/supabase.js',
    '^expo-video$': '<rootDir>/__mocks__/expo-video.js',
    '^@react-native-community/slider$': '<rootDir>/__mocks__/slider.js',
  },
};
