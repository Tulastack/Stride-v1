import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, Video, Upload, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';

export default function RecordScreen() {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);

  // Mock selecting video from gallery or camera
  const handleSelectVideo = () => {
    // In a real device:
    // const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos })
    setVideoUri('ph://sprint-recording-001.mp4');
    Alert.alert('Video Selected', 'Captured sprint video at 120 FPS. Ready for compression & upload.');
  };

  const handleStartRecord = () => {
    setRecording(true);
    setProgressStep('Recording...');
    setTimeout(() => {
      setRecording(false);
      setVideoUri('ph://sprint-live-002.mp4');
      setProgressStep(null);
      Alert.alert('Sprint Captured', 'Successfully recorded 5-second sprint segment at 60 FPS.');
    }, 4000);
  };

  const handleUploadAndAnalyze = async () => {
    if (!videoUri) {
      Alert.alert('Error', 'Please record or select a video first.');
      return;
    }

    setUploading(true);
    setProgressStep('Compressing video (subsampling to 10 FPS)...');

    try {
      // Step 1: Simulate video compression/subsampling
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 2: Get presigned multipart URLs (3 parts for demonstration)
      setProgressStep('Requesting S3 multipart upload signatures...');
      const uploadDetails = await strideApi.requestUploadUrls(3);
      const { analysisId, uploadId, parts } = uploadDetails;

      // Step 3: Upload chunks to S3 presigned URLs
      setProgressStep('Uploading chunk 1/3 (0-2s)...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setProgressStep('Uploading chunk 2/3 (2-4s)...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setProgressStep('Uploading chunk 3/3 (4-5s)...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Step 4: Finalize S3 multipart and trigger SQS ML job
      setProgressStep('Finalizing multipart upload & enqueuing SQS job...');
      const completedParts = parts.map((p) => ({
        partNumber: p.partNumber,
        etag: `mock-etag-part-${p.partNumber}`,
      }));

      await strideApi.finalizeUpload(analysisId, uploadId, completedParts);

      setUploading(false);
      setProgressStep(null);
      setVideoUri(null);

      // Redirect immediately to analysis screen with the newly created analysisId!
      router.push({
        pathname: '/(tabs)/analysis',
        params: { analysisId },
      });
    } catch (err: any) {
      setUploading(false);
      setProgressStep(null);
      Alert.alert('Upload Failed', err.message || 'An error occurred during video analysis preparation.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} bounces={false}>
      <Text style={styles.title}>Form Analyzer</Text>
      <Text style={styles.subtitle}>Record a side-on sprint segment. Ensure your full stride is visible in the frame.</Text>

      {uploading ? (
        <View style={styles.uploadingContainer}>
          <ActivityIndicator size="large" color="#FF453A" />
          <Text style={styles.progressText}>{progressStep}</Text>
          <Text style={styles.uploadSubtext}>Do not close the app or lock your screen.</Text>
        </View>
      ) : (
        <View style={styles.actionContainer}>
          {videoUri ? (
            <View style={styles.readyCard}>
              <CheckCircle2 color="#34C759" size={48} />
              <Text style={styles.readyTitle}>Sprint Video Ready</Text>
              <Text style={styles.readySubtitle}>{videoUri}</Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={handleUploadAndAnalyze}>
                <Upload color="#FFFFFF" size={20} />
                <Text style={styles.primaryBtnText}>Compress & Analyze Form</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setVideoUri(null)}>
                <Text style={styles.secondaryBtnText}>Discard & Re-take</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.selectorCard}>
              <TouchableOpacity 
                style={[styles.recordBox, recording ? styles.recordingBox : null]} 
                onPress={handleStartRecord}
                disabled={recording}
              >
                {recording ? (
                  <View style={styles.recordingIndicatorContainer}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingText}>Capturing... 60 FPS</Text>
                  </View>
                ) : (
                  <>
                    <Camera color="#FF453A" size={40} />
                    <Text style={styles.recordBoxTitle}>Record Live Sprint</Text>
                    <Text style={styles.recordBoxDesc}>Locks standard 1080p 60 FPS recording</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.galleryButton} onPress={handleSelectVideo}>
                <Video color="#FF9F0A" size={24} />
                <View style={styles.galleryTextContainer}>
                  <Text style={styles.galleryTitle}>Import Slow-Mo Video</Text>
                  <Text style={styles.galleryDesc}>Select pre-recorded 120/240 FPS files</Text>
                </View>
                <ChevronRight color="#8E94A8" size={20} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Tips for Elite Analysis:</Text>
            <Text style={styles.tipItem}>• Keep camera perpendicular (exactly side-on) to track lane.</Text>
            <Text style={styles.tipItem}>• Ensure camera is stationary (use tripod or flat surface).</Text>
            <Text style={styles.tipItem}>• Capture at least 3-4 consecutive stride cycles at max speed.</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0B0D17',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 40,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#8E94A8',
    lineHeight: 22,
    marginBottom: 40,
  },
  actionContainer: {
    gap: 24,
  },
  selectorCard: {
    gap: 20,
  },
  recordBox: {
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  recordingBox: {
    borderColor: '#FF453A',
    backgroundColor: '#1E141B',
  },
  recordBoxTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  recordBoxDesc: {
    fontSize: 13,
    color: '#8E94A8',
  },
  recordingIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF453A',
  },
  recordingText: {
    color: '#FF453A',
    fontSize: 18,
    fontWeight: 'bold',
  },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  galleryTextContainer: {
    flex: 1,
    marginLeft: 16,
  },
  galleryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  galleryDesc: {
    fontSize: 12,
    color: '#8E94A8',
    marginTop: 2,
  },
  readyCard: {
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  readyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  readySubtitle: {
    color: '#8E94A8',
    fontSize: 13,
    textAlign: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF453A',
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    marginTop: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    width: '100%',
  },
  secondaryBtnText: {
    color: '#8E94A8',
    fontSize: 14,
    fontWeight: '600',
  },
  uploadingContainer: {
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  progressText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 22,
  },
  uploadSubtext: {
    color: '#8E94A8',
    fontSize: 12,
  },
  tipsCard: {
    backgroundColor: '#1F1E24',
    borderRadius: 16,
    padding: 20,
    borderColor: '#2D2B33',
    borderWidth: 1,
  },
  tipsTitle: {
    color: '#FF9F0A',
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 8,
  },
  tipItem: {
    color: '#8E94A8',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
});
