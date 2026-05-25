// Mock for react-native's ViewConfigIgnore.js
// The original uses 'const T' Flow type parameter syntax that hermes-parser 0.25.1 can't parse.

function DynamicallyInjectedByGestureHandler(object) {
  return object;
}

function ConditionallyIgnoredEventHandlers(value) {
  return value;
}

function isIgnored() {
  return false;
}

module.exports = {
  DynamicallyInjectedByGestureHandler,
  ConditionallyIgnoredEventHandlers,
  isIgnored,
};
