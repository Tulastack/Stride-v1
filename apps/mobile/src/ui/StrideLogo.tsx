import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const wordmark = require('../../assets/stride-logo.png');
const mark = require('../../assets/stride-mark.png');
const WORDMARK_ASPECT = 4.122;
const MARK_ASPECT = 1.261;

export function StrideLogo({ height = 28, color, style, markOnly = false }: {
  height?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
  markOnly?: boolean;
}) {
  const { colors } = useTheme();
  const aspect = markOnly ? MARK_ASPECT : WORDMARK_ASPECT;
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel="Stride"
      source={markOnly ? mark : wordmark}
      resizeMode="contain"
      style={[{ width: Math.round(height * aspect), height, tintColor: color ?? colors.text }, style]}
    />
  );
}
