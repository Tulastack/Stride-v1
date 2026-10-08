import fs from 'fs';
import path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Stat } from '../ui';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { palettes, materials } from '../theme';

const mobileRoot = path.resolve(__dirname, '../..');
function sourceClosure(filename: string, visited = new Set<string>()): Set<string> {
  if (visited.has(filename)) return visited;
  visited.add(filename);
  const source = fs.readFileSync(filename, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    const location = path.resolve(path.dirname(filename), match[1]);
    const resolved = [location + '.tsx', location + '.ts', path.join(location, 'index.tsx'), path.join(location, 'index.ts')].find(fs.existsSync);
    if (resolved) sourceClosure(resolved, visited);
  }
  return visited;
}
function routes(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? routes(filename) : /\.tsx$/.test(filename) ? [filename] : [];
  });
}
const runtime = routes(path.join(mobileRoot, 'app')).reduce((visited, route) => sourceClosure(route, visited), new Set<string>());
const components = [...runtime].filter((filename) => /\/(app|ui|components)\//.test(filename));
function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground: string, background: string): number {
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('Shipping design system', () => {
  it('uses semantic colors and native typography throughout the shipping UI', () => {
    expect(components.length).toBeGreaterThan(20);
    const offenders = components.filter((filename) => {
      const source = fs.readFileSync(filename, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      return /#[\da-f]{6}\b|rgba?\(|fontFamily\s*:/i.test(source) || (/BlurView|expo-blur/.test(source) && !filename.endsWith('/ui/StrideTabBar.tsx'));
    });
    expect(offenders.map((filename) => path.relative(mobileRoot, filename))).toEqual([]);
  });
  it('never loads synthetic form targets or fixtures in the app', () => {
    expect([...runtime].filter((filename) => /FormTargetView|formTargetPose|\/fixtures\//.test(filename))).toEqual([]);
  });
  it('gives both themes the same semantic role contract', () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });
  it.each(['light', 'dark'] as const)('%s text pairs meet WCAG AA', (mode) => {
    const colors = palettes[mode];
    const pairs: [keyof typeof colors, keyof typeof colors][] = [
      ['text', 'bg'], ['text', 'card'], ['text', 'cardAlt'], ['text', 'sage'],
      ['muted', 'bg'], ['muted', 'card'], ['muted', 'cardAlt'], ['muted', 'sage'],
      ['goldInk', 'bg'], ['goldInk', 'champagne'], ['accentText', 'accent'],
      ['wellText', 'well'], ['wellMuted', 'well'], ['sageInk', 'sage'],
      ['error', 'cardAlt'], ['success', 'bg'],
    ];
    for (const [foreground, background] of pairs) {
      expect({ pair: foreground + '/' + background, ratio: contrast(colors[foreground], colors[background]) })
        .toEqual({ pair: foreground + '/' + background, ratio: expect.any(Number) });
      expect(contrast(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps disabled actions inert and touch targets usable', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<Button label="Analyze" testID="analyze" disabled onPress={onPress} />);
    const button = getByTestId('analyze');
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(materials.minTarget);
    expect(button.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

function ThemeExample() {
  const { mode, setAppearance } = useTheme();
  return <><Card testID="card"><Stat label="Cadence" value={240} unit="spm" /></Card>
    <Button testID="theme-toggle" label={mode} onPress={() => setAppearance(mode === 'light' ? 'dark' : 'light')} /></>;
}
describe('Theme persistence and live primitives', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });
  it('updates the whole primitive surface and remembers the selection', async () => {
    const { getByTestId, getByText } = render(<ThemeProvider><ThemeExample /></ThemeProvider>);
    await waitFor(() => expect(getByText('light')).toBeTruthy());
    fireEvent.press(getByTestId('theme-toggle'));
    await waitFor(() => expect(getByText('dark')).toBeTruthy());
    expect(StyleSheet.flatten(getByTestId('card').props.style).backgroundColor).toBe(palettes.dark.card);
    expect(await AsyncStorage.getItem('stride.appearance')).toBe('dark');
  });
  it('restores a persisted explicit theme', async () => {
    await AsyncStorage.setItem('stride.appearance', 'dark');
    const { getByText, getByTestId } = render(<ThemeProvider><ThemeExample /></ThemeProvider>);
    await waitFor(() => expect(getByText('dark')).toBeTruthy());
    expect(StyleSheet.flatten(getByTestId('card').props.style).backgroundColor).toBe(palettes.dark.card);
  });
});
