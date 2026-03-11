import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';

// DEV BYPASS SCREEN — replaces passkey registration until WebAuthn is wired up.
//
// Flow: KYC completes → user's Persona selfie is stored as profile_photo_s3_key
//       → user takes a live selfie here
//       → server calls AWS Rekognition CompareFaces against the stored photo
//       → if score >= 85%, status is set to 'active' → user reaches home
//
// TO RE-ENABLE PASSKEYS:
//   1. Set RPID and MOBILE_ORIGIN in server .env (already done)
//   2. Set APPLE_TEAM_ID in server .env (your 10-char Apple Developer Team ID)
//   3. Confirm app.json has associatedDomains: ["webcredentials:nai.lironkatsif.com"] (already done)
//   4. Rebuild with: cd mobile && npx expo run:ios
//   5. In kyc.tsx, change router.replace('/face-verify') back to router.replace('/passkey')
//   6. The passkey.tsx screen is ready — no changes needed there

type Step = 'intro' | 'camera' | 'checking' | 'error';

export default function FaceVerify() {
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
    setStep('checking');
    try {
      const raw = await cameraRef.current!.takePictureAsync({ base64: false, quality: 1 });
      if (!raw?.uri) throw new Error('Camera did not return a photo');

      const resized = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!resized.base64) throw new Error('Image resize failed');

      const { passed, score } = await api.faceActivateBypass(resized.base64);

      if (!passed) {
        setError(`Face did not match your ID photo (score: ${score.toFixed(1)}%). Try better lighting or a straight-on angle.`);
        setStep('error');
        return;
      }

      router.replace('/home');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
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
            Look straight at the camera
          </Text>
          <PrimaryButton label="Capture" onPress={handleCapture} />
        </View>
      </View>
    );
  }

  if (step === 'checking') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-ink text-xl font-semibold text-center">Verifying your face...</Text>
        <Text className="text-muted text-sm text-center">Comparing against your ID photo</Text>
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
            <Text className="text-5xl">🤳</Text>
          </View>
          <Text className="text-ink text-3xl font-bold text-center">Confirm your identity</Text>
          <Text className="text-muted text-base text-center leading-relaxed">
            Take a quick selfie to confirm you're the person from your ID. Make sure your face is
            well-lit and clearly visible.
          </Text>
        </View>
        <PrimaryButton label="Open Camera" onPress={handleStart} />
      </View>
    </SafeAreaView>
  );
}
