import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';

type Step = 'intro' | 'camera' | 'uploading' | 'error';

export default function FaceEnroll() {
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  async function handleStart() {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        setError('Camera permission is required.');
        setStep('error');
        return;
      }
    }
    setStep('camera');
  }

  async function handleCapture() {
    setStep('uploading');
    try {
      const raw = await cameraRef.current!.takePictureAsync({ base64: false, quality: 1 });
      if (!raw?.uri) throw new Error('Camera did not return a photo');

      const resized = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!resized.base64) throw new Error('Image resize failed');

      await api.faceEnroll(resized.base64);
      router.replace('/passkey');
    } catch (err: any) {
      setError(err.message || 'Failed to enroll face');
      setStep('error');
    }
  }

  if (step === 'camera') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        <View className="absolute bottom-12 left-0 right-0 items-center px-8 gap-4">
          <Text
            className="text-white text-base font-semibold text-center"
            style={{ textShadowColor: '#000', textShadowRadius: 4 }}
          >
            Position your face clearly in frame
          </Text>
          <PrimaryButton label="Capture" onPress={handleCapture} />
        </View>
      </View>
    );
  }

  if (step === 'uploading') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-ink text-xl font-semibold text-center">Saving your face...</Text>
      </SafeAreaView>
    );
  }

  if (step === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-6">
        <Text className="text-red-500 text-base text-center">{error}</Text>
        <PrimaryButton label="Try Again" onPress={() => setStep('intro')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-8 pb-12 justify-between">
        <View className="flex-1 items-center justify-center gap-6">
          <View className="w-24 h-24 rounded-full bg-surface items-center justify-center">
            <Text className="text-5xl">📷</Text>
          </View>
          <Text className="text-ink text-3xl font-bold text-center">Register your face</Text>
          <Text className="text-muted text-base text-center leading-relaxed">
            Take a clear selfie in good lighting. This photo is used to verify it's you during future check-ins.
          </Text>
        </View>
        <PrimaryButton label="Open Camera" onPress={handleStart} />
      </View>
    </SafeAreaView>
  );
}
