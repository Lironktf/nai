import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PrimaryButton } from '../components/PrimaryButton';
import { captureAndCheckFace } from '../lib/embeddings';
import { api } from '../lib/api';

type Step = 'camera' | 'checking' | 'syncing' | 'result' | 'error';

export default function TestFace() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('camera');
  const [result, setResult] = useState<{ passed: boolean; score: number } | null>(null);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  async function handleCheck() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setError('Camera permission denied.');
        setStep('error');
        return;
      }
    }
    if (!cameraReady) {
      setError('Camera not ready yet — wait a moment and try again.');
      setStep('error');
      return;
    }
    setStep('checking');
    // Brief pause to let the camera stabilize before capture (prevents hang in Expo Go).
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await captureAndCheckFace(cameraRef.current as any, '');
      setResult(res);
      setStep('result');
    } catch (err: any) {
      setError(err.message || 'Face check failed');
      setStep('error');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1">
        {/* Camera preview — always mounted so ref is ready */}
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="front"
          onCameraReady={() => setCameraReady(true)}
        />

        {/* Overlay */}
        <View className="absolute inset-0 justify-end px-6 pb-10">
          {step === 'camera' && (
            <PrimaryButton
              label={cameraReady ? 'Check My Face' : 'Waiting for camera…'}
              onPress={handleCheck}
              disabled={!cameraReady}
            />
          )}

          {step === 'checking' && (
            <View className="bg-bg/90 rounded-2xl p-6 items-center gap-3">
              <ActivityIndicator size="large" color="#1A3A5C" />
              <Text className="text-ink text-base font-semibold">Running Rekognition...</Text>
            </View>
          )}

          {step === 'result' && result && (
            <View className="bg-bg rounded-2xl p-6 items-center gap-4">
              <Text className={`text-4xl font-bold ${result.passed ? 'text-success' : 'text-red-500'}`}>
                {result.passed ? '✓ Match' : '✗ No Match'}
              </Text>
              <Text className="text-ink text-lg">
                Similarity: <Text className="font-bold">{result.score.toFixed(1)}%</Text>
              </Text>
              <Text className="text-muted text-sm text-center">
                Threshold: 85% · Your profile photo is the reference
              </Text>
              <PrimaryButton label="Try Again" onPress={() => setStep('camera')} />
              <PrimaryButton label="Done" onPress={() => router.back()} variant="ghost" />
            </View>
          )}

          {step === 'syncing' && (
            <View className="bg-bg/90 rounded-2xl p-6 items-center gap-3">
              <ActivityIndicator size="large" color="#1A3A5C" />
              <Text className="text-ink text-base font-semibold">Syncing profile photo from Persona...</Text>
            </View>
          )}

          {step === 'error' && (
            <View className="bg-bg rounded-2xl p-6 items-center gap-4">
              <Text className="text-red-500 text-base text-center">{error}</Text>
              {error.includes('reference face photo') || error.includes('No reference') ? (
                <PrimaryButton
                  label="Sync Photo from Persona"
                  onPress={async () => {
                    setStep('syncing');
                    try {
                      await api.syncProfilePhoto();
                      setStep('camera');
                    } catch (e: any) {
                      setError(e.message || 'Sync failed');
                      setStep('error');
                    }
                  }}
                />
              ) : (
                <PrimaryButton label="Try Again" onPress={() => setStep('camera')} />
              )}
              <PrimaryButton label="Back" onPress={() => router.back()} variant="ghost" />
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
