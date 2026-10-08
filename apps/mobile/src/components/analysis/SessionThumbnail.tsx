import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { strideApi } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import { type as typo } from '../../theme';

export function SessionThumbnail({ analysisId }: { analysisId: string }) {
  const { colors } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { let active = true; strideApi.videoFileUrl(analysisId).then((value) => { if (active) setUri(value); }).catch(() => {}); return () => { active = false; }; }, [analysisId]);
  return uri ? <ThumbnailFilm uri={uri} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={[typo.tiny, { color: colors.muted }]}>FILM</Text></View>;
}

function ThumbnailFilm({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (video) => { video.muted = true; video.pause(); });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} pointerEvents="none" />;
}
