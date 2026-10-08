import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockRecord = jest.fn();
const mockStop = jest.fn();
const mockImport = jest.fn();
const mockUpload = jest.fn();
const mockManifest = jest.fn((...parameters: unknown[]) => ({}));
let mockCameraGranted = true;
const mockCameraRequest = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: mockCameraGranted }, mockCameraRequest],
    useMicrophonePermissions: () => [{ granted: true }, jest.fn()],
    CameraView: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ recordAsync: mockRecord, stopRecording: mockStop }));
      return <View {...props} testID="camera" />;
    }),
  };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockImport(...args) }));
jest.mock('../services/capture', () => ({
  GyroRecorder: class { async start() {} stop() { return []; } },
  AccelRecorder: class { async start() {} stop() { return []; } },
  CAPTURE_PREFS: { preferredFps: 120 },
  buildCaptureManifest: (...args: unknown[]) => mockManifest(...args),
  uploadCaptureVideo: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('../components/TargetSelect', () => {
  const { View, Text, Pressable } = require('react-native');
  return { TargetSelect: ({ onSkip, onCancel }: any) => <View><Text>Choose your athlete</Text>
    <Pressable accessibilityLabel="Use clip" onPress={onSkip}><Text>Use clip</Text></Pressable>
    <Pressable accessibilityLabel="Discard clip" onPress={onCancel}><Text>Discard clip</Text></Pressable></View> };
});
import CaptureScreen from '../../app/(tabs)/index';
import { TabChromeProvider, useTabChrome } from '../context/TabChromeContext';
import { Text } from 'react-native';
import type { CameraView } from 'expo-camera';
import { CaptureCamera } from '../components/CaptureCamera';

function DockStatus() {
  const { hidden } = useTabChrome();
  return <Text>{hidden ? 'Dock hidden' : 'Dock visible'}</Text>;
}

describe('Capture and import workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCameraGranted = true;
    mockCameraRequest.mockResolvedValue({ granted: false });
    mockImport.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///run.mov', width: 1920, height: 1080, duration: 6000 }] });
    mockUpload.mockResolvedValue({ analysisId: 'analysis' });
  });
  it('leaves import available when camera access is denied', async () => {
    mockCameraGranted = false;
    const { getByLabelText, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Record sprint'));
    await waitFor(() => expect(getByText(/Camera access is needed/)).toBeTruthy());
    fireEvent.press(getByLabelText('Import from library'));
    await waitFor(() => expect(getByText('Choose your athlete')).toBeTruthy());
  });
  it('does not upload until target selection is explicitly confirmed or skipped', async () => {
    const { getByLabelText, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Import from library'));
    await waitFor(() => expect(getByText('Choose your athlete')).toBeTruthy());
    expect(mockUpload).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Use clip'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/analysis', params: { analysisId: 'analysis' } }));
    expect(mockManifest).toHaveBeenCalledWith(expect.objectContaining({ videoUri: 'file:///run.mov', durationMs: 6000, widthPx: 1920, heightPx: 1080 }));
  });
  it('retains the chosen clip after failure and retries the real upload', async () => {
    mockUpload.mockRejectedValueOnce(new Error('Upload failed'));
    const { getByLabelText, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Import from library'));
    await waitFor(() => expect(getByText('Choose your athlete')).toBeTruthy());
    fireEvent.press(getByLabelText('Use clip'));
    await waitFor(() => expect(getByText('Retry upload')).toBeTruthy());
    fireEvent.press(getByText('Retry upload'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls[0][0]).toBe(mockUpload.mock.calls[1][0]);
  });
  it('supports discarding a selection without sending it', async () => {
    const { getByLabelText, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Import from library'));
    await waitFor(() => expect(getByText('Choose your athlete')).toBeTruthy());
    fireEvent.press(getByLabelText('Discard clip'));
    expect(getByText('Meet your stride.')).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('records only when ready, enforces 12 seconds, and discards cancelled recordings', async () => {
    let resolveRecording: (value: any) => void = () => {};
    mockRecord.mockReturnValue(new Promise((resolve) => { resolveRecording = resolve; }));
    const { getByLabelText, getByTestId, queryByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Record sprint'));
    await waitFor(() => expect(getByTestId('camera')).toBeTruthy());
    fireEvent.press(getByLabelText('Start recording'));
    expect(mockRecord).not.toHaveBeenCalled();
    fireEvent(getByTestId('camera'), 'cameraReady');
    fireEvent.press(getByLabelText('Start recording'));
    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith({ maxDuration: 12 }));
    fireEvent.press(getByLabelText('Cancel recording'));
    await act(async () => resolveRecording({ uri: 'file:///cancelled.mov' }));
    expect(queryByText('Choose your athlete')).toBeNull();
    expect(mockStop).toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('uses immersive capture with a toggleable framing guide and restores the dock on exit', async () => {
    const { getByLabelText, getByTestId, getByText, queryByTestId } = render(<TabChromeProvider><CaptureScreen /><DockStatus /></TabChromeProvider>);
    expect(getByText('Dock visible')).toBeTruthy();
    fireEvent.press(getByLabelText('Record sprint'));
    await waitFor(() => expect(getByTestId('capture-camera-stage')).toBeTruthy());
    expect(getByText('Dock hidden')).toBeTruthy();
    fireEvent.press(getByLabelText('Hide framing guide'));
    expect(queryByTestId('camera-framing-guide')).toBeNull();
    fireEvent.press(getByLabelText('Show framing guide'));
    expect(getByTestId('camera-framing-guide')).toBeTruthy();
    fireEvent.press(getByLabelText('Cancel recording'));
    await waitFor(() => expect(getByText('Dock visible')).toBeTruthy());
  });
  it('opens the library directly from the camera without starting an upload', async () => {
    const { getByLabelText, getByTestId, getByText, queryByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Record sprint'));
    await waitFor(() => expect(getByTestId('camera')).toBeTruthy());
    fireEvent.press(getByLabelText('Import from library'));
    await waitFor(() => expect(getByText('Choose your athlete')).toBeTruthy());
    expect(queryByTestId('camera')).toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('shows actual recording progress and prevents library interruption', async () => {
    let finish: (value: { uri: string }) => void = () => {};
    mockRecord.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { getByLabelText, getByTestId, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Record sprint'));
    await waitFor(() => expect(getByTestId('camera')).toBeTruthy());
    fireEvent(getByTestId('camera'), 'cameraReady');
    fireEvent.press(getByLabelText('Start recording'));
    await waitFor(() => expect(mockRecord).toHaveBeenCalled());
    expect(getByTestId('recording-progress-ring')).toBeTruthy();
    expect(getByLabelText('Import from library').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByLabelText('Import from library'));
    expect(mockImport).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Stop recording'));
    await act(async () => finish({ uri: 'file:///sprint.mov' }));
    expect(getByText('Choose your athlete')).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('renders the shutter ring from elapsed time rather than invented analysis progress', () => {
    const { getByTestId, getByLabelText } = render(<CaptureCamera cameraRef={React.createRef<CameraView>()} ready recording elapsed={6} onReady={jest.fn()} onRecord={jest.fn()} onStop={jest.fn()} onCancel={jest.fn()} onImport={jest.fn()} onError={jest.fn()} />);
    expect(getByTestId('recording-progress-ring').props.strokeDashoffset).toBeCloseTo(Math.PI * 41);
    expect(getByLabelText('6.0 of 12 seconds recorded')).toBeTruthy();
  });
});
