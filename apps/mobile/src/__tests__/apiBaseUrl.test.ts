/**
 * Which address the app talks to. This has broken phone testing twice over:
 * once because the derived URL used the wrong port, and once because a baked
 * EXPO_PUBLIC_API_BASE_URL went stale when DHCP moved the Mac.
 */

// Held out here on purpose. Each case re-requires the store through
// jest.resetModules(), which rebuilds the mock too, so the values it should
// report have to live somewhere the module registry does not reset.
const mockHost: { hostUri?: string; debuggerHost?: string } = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockHost.hostUri ? { hostUri: mockHost.hostUri } : null;
    },
    get expoGoConfig() {
      return mockHost.debuggerHost ? { debuggerHost: mockHost.debuggerHost } : null;
    },
  },
}));

function resolve(env?: string): string {
  jest.resetModules();
  if (env === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = env;
  // require, not import(): jest here runs CJS, and a dynamic import needs
  // --experimental-vm-modules.
  return require('../store/useStrideStore').resolveApiBaseUrl();
}

describe('resolveApiBaseUrl', () => {
  beforeEach(() => {
    delete mockHost.hostUri;
    delete mockHost.debuggerHost;
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  });

  it('talks to the API port, not the Metro port', () => {
    // The bug: this derived the right host and then used :3000, while the API
    // has always run on :3001. Every derived request went nowhere.
    mockHost.hostUri = '192.168.1.117:8081';
    expect(resolve()).toBe('http://192.168.1.117:3001');
  });

  it('prefers the machine serving the bundle over a stale baked address', () => {
    // EXPO_PUBLIC_* is inlined at bundle time, so it keeps pointing at whatever
    // IP the Mac had when the bundle was built. The dev server host cannot be
    // stale: the phone just downloaded the bundle from it.
    mockHost.hostUri = '192.168.1.117:8081';
    expect(resolve('http://192.168.1.150:3001')).toBe('http://192.168.1.117:3001');
  });

  it('keeps a configured non-default port when deriving the host', () => {
    mockHost.hostUri = '192.168.1.117:8081';
    expect(resolve('http://192.168.1.150:4000')).toBe('http://192.168.1.117:4000');
  });

  it('reads the older debuggerHost when hostUri is absent', () => {
    mockHost.debuggerHost = '10.0.0.5:8081';
    expect(resolve()).toBe('http://10.0.0.5:3001');
  });

  it('falls back to the env var when there is no dev host', () => {
    expect(resolve('https://api.stride.app')).toBe('https://api.stride.app');
  });

  it('ignores a loopback dev host, which the phone cannot reach', () => {
    mockHost.hostUri = 'localhost:8081';
    expect(resolve('http://192.168.1.150:3001')).toBe('http://192.168.1.150:3001');
  });
});
