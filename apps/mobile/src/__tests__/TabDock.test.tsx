import React from 'react';
import { AccessibilityInfo, PanResponder, Pressable, Text, Keyboard, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StrideTabBar } from '../ui/StrideTabBar';
import { TabChromeProvider, useTabChrome } from '../context/TabChromeContext';
import { dockIndex, dockPosition, dockTouchPosition } from '../lib/tabDock';
import { palettes } from '../theme';

type Props = React.ComponentProps<typeof StrideTabBar>;
const routes = ['index', 'analysis', 'progress', 'coach', 'calendar', 'settings'].map((name) => ({ key: name, name }));
const titles = ['Capture', 'Analysis', 'Progress', 'Coach', 'Plan', 'Settings'];
function fixture(index = 0) {
  const navigation = { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) };
  return {
    state: { index, routes },
    descriptors: Object.fromEntries(routes.map((route, position) => [route.key, { options: { title: titles[position], tabBarButtonTestID: `tab-${route.name}` } }])),
    navigation,
  } as unknown as Props & { navigation: typeof navigation };
}
function ImmersiveToggle() {
  const { hidden, bottomSpace, setImmersive } = useTabChrome();
  return <Pressable accessibilityLabel="Toggle immersive" onPress={() => setImmersive(!hidden)}><Text>{bottomSpace ? 'Reserved space' : 'No dock space'}</Text></Pressable>;
}

describe('Stride glass dock', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  });
  afterEach(() => jest.restoreAllMocks());
  it('keeps five icon tabs, single-line captions and usable targets', async () => {
    const props = fixture();
    const { getAllByRole, getByText, queryByText, getByLabelText } = render(<StrideTabBar {...props} />);
    await act(async () => {});
    expect(getAllByRole('tab')).toHaveLength(5);
    expect(queryByText('Analysis')).toBeNull();
    expect(getByText('Capture').props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(getByLabelText('Capture').props.style).minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(getByLabelText('Coach'));
    expect(props.navigation.navigate).toHaveBeenCalledWith('coach', undefined);
    expect(props.navigation.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'coach', canPreventDefault: true });
  });
  it('honors prevented navigation and maps hidden analysis to Progress', async () => {
    const props = fixture(1);
    props.navigation.emit.mockReturnValue({ defaultPrevented: true });
    const { getByLabelText } = render(<StrideTabBar {...props} />);
    await act(async () => {});
    expect(getByLabelText('Progress').props.accessibilityState.selected).toBe(true);
    fireEvent.press(getByLabelText('Settings'));
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });
  it('previews a drag without navigation, commits on release, and cancels interrupted drags', async () => {
    const spy = jest.spyOn(PanResponder, 'create');
    const props = fixture();
    const { getByTestId } = render(<StrideTabBar {...props} />);
    act(() => getByTestId('stride-tab-dock').props.onLayout({ nativeEvent: { layout: { width: 358 } } }));
    await act(async () => {});
    expect(StyleSheet.flatten(getByTestId('tab-drag-lens').props.style).width).toBe(70);
    const handlers = spy.mock.calls.map(([configuration]) => configuration).findLast((configuration) => configuration.onMoveShouldSetPanResponder?.({} as never, { dx: 10, dy: 0 } as never));
    expect(handlers).toBeDefined();
    const event = {} as Parameters<NonNullable<NonNullable<typeof handlers>['onPanResponderGrant']>>[0];
    const gesture = { x0: 39, dx: 145, dy: 0 } as Parameters<NonNullable<NonNullable<typeof handlers>['onPanResponderMove']>>[1];
    act(() => { handlers?.onPanResponderGrant?.(event, gesture); handlers?.onPanResponderMove?.(event, gesture); });
    expect(props.navigation.navigate).not.toHaveBeenCalled();
    act(() => handlers?.onPanResponderRelease?.(event, gesture));
    expect(props.navigation.navigate).toHaveBeenCalledWith('coach', undefined);
    props.navigation.navigate.mockClear();
    act(() => { handlers?.onPanResponderGrant?.(event, gesture); handlers?.onPanResponderMove?.(event, gesture); handlers?.onPanResponderTerminate?.(event, gesture); });
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });
  it('uses a solid material when Reduce Transparency is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
    const { queryByTestId, getByTestId } = render(<StrideTabBar {...fixture()} />);
    await act(async () => {});
    expect(queryByTestId('tab-glass-material')).toBeNull();
    expect(StyleSheet.flatten(getByTestId('stride-tab-dock').props.style).backgroundColor).toBe(palettes.light.card);
  });
  it('hides the dock and releases its space during capture and keyboard input', async () => {
    const listener = jest.spyOn(Keyboard, 'addListener');
    const { getByLabelText, getByText, queryByTestId } = render(<TabChromeProvider><StrideTabBar {...fixture()} /><ImmersiveToggle /></TabChromeProvider>);
    await act(async () => {});
    expect(getByText('Reserved space')).toBeTruthy();
    fireEvent.press(getByLabelText('Toggle immersive'));
    expect(queryByTestId('stride-tab-dock')).toBeNull();
    expect(getByText('No dock space')).toBeTruthy();
    fireEvent.press(getByLabelText('Toggle immersive'));
    const show = listener.mock.calls.find(([name]) => name === (Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'))![1];
    act(() => show({} as Parameters<typeof show>[0]));
    await waitFor(() => expect(queryByTestId('stride-tab-dock')).toBeNull());
    const hide = listener.mock.calls.find(([name]) => name === (Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'))![1];
    act(() => hide({} as Parameters<typeof hide>[0]));
    expect(queryByTestId('stride-tab-dock')).toBeTruthy();
  });
});

describe('Dock drag geometry', () => {
  it('clamps the lens and rounds only when choosing a destination', () => {
    expect(dockPosition(-2, 5)).toBe(0);
    expect(dockPosition(7, 5)).toBe(4);
    expect(dockPosition(1.4, 5)).toBe(1.4);
    expect(dockIndex(1.4, 5)).toBe(1);
    expect(dockIndex(1.6, 5)).toBe(2);
    expect(dockTouchPosition(12 + 4 + 70 * 4.5, 12, 358, 5)).toBe(4);
    expect(dockTouchPosition(12 + 4 + 70 * 2.5, 12, 358, 5)).toBe(2);
    expect(dockTouchPosition(-20, 12, 358, 5)).toBe(0);
    expect(dockTouchPosition(500, 12, 358, 5)).toBe(4);
  });
});
