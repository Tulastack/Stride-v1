import type { ViewStyle } from 'react-native';
import type { OrbSize, OrbState } from 'thinking-orbs/engine';

export type { OrbSize, OrbState };

/** `auto` follows the OS appearance. Pass `dark` or `light` from the app theme. */
export type OrbTheme = 'auto' | 'dark' | 'light';

export interface ThinkingOrbProps {
  /** Which animation to show. @default 'working' */
  state?: OrbState;
  /** Tuned size preset: 64, 32, or 20. @default 64 */
  size?: OrbSize;
  /** Theme mode. `auto` follows the OS appearance. @default 'auto' */
  theme?: OrbTheme;
  /** Speed multiplier on top of the preset speed. @default 1 */
  speed?: number;
  /** Freeze on the current frame. @default false */
  paused?: boolean;
  /**
   * Draw the tuned `size` geometry into a canvas of this many points.
   * The two presets are separate designs, then scaled as vectors.
   */
  displaySize?: number;
  /** Overrides the per-state default. */
  accessibilityLabel?: string;
  style?: ViewStyle;
}
