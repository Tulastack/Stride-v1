const React = require('react');

const useRouter = () => ({
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
});

const useLocalSearchParams = () => ({});

const Stack = {
  Screen: ({ children }) => children || null,
};

module.exports = { useRouter, useLocalSearchParams, Stack };
