import { View, Text, Image, ActivityIndicator, Animated } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';
import { assertPasskey } from '../lib/passkey';
import { captureAndCheckFace } from '../lib/embeddings';

type VerifyStep =
  | 'waiting'
  | 'incoming'
  | 'auth'
  | 'face_check'   // camera open, waiting for user to capture
  | 'checking'     // server evaluating face match
  | 'peer_pending'
  | 'error';

export default function Verify() {
  const { sessionId, peerName, peerPhoto, mode } = useLocalSearchParams<{
    sessionId: string;
    peerName: string;
    peerPhoto: string;
    mode: 'outgoing' | 'incoming';
  }>();

  const [step, setStep] = useState<VerifyStep>(mode === 'incoming' ? 'incoming' : 'waiting');
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
    if (mode !== 'incoming') startPollingForAcceptance();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPollingForAcceptance() {
    pollRef.current = setInterval(async () => {
      try {
        const { state } = await api.sessionStatus(sessionId);
        if (state === 'awaiting_both') {
          clearInterval(pollRef.current!);
          setStep('auth');
        } else if (state === 'failed') {
          clearInterval(pollRef.current!);
          setError('Request declined or expired.');
          setStep('error');
        }
      } catch {}
    }, 2000);
  }

  async function handleAccept() {
    await api.acceptVerification(sessionId);
    setStep('auth');
  }

  async function handleDecline() {
    await api.declineVerification(sessionId);
    router.replace('/home');
  }

  async function handleAuth() {
    setError('');
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        setError('Camera permission is required for face verification.');
        setStep('error');
        return;
      }
    }
    setStep('face_check');
  }

  async function handleCapture() {
    setStep('checking');
    try {
      const { passed, score } = await captureAndCheckFace(cameraRef.current!, sessionId);
      if (!passed) {
        setError(`Face does not match your profile (score: ${score.toFixed(1)}%). Please try again in better lighting.`);
        setStep('error');
        return;
      }
      await assertPasskey(sessionId);
      startPollingForCompletion();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setStep('error');
    }
  }

  function startPollingForCompletion() {
    setStep('peer_pending');
    pollRef.current = setInterval(async () => {
      try {
        const { state, verificationCode } = await api.sessionStatus(sessionId);
        if (state === 'verified' && verificationCode) {
          clearInterval(pollRef.current!);
          router.replace({ pathname: '/confirmed', params: { peerName, code: verificationCode } });
        } else if (state === 'failed') {
          clearInterval(pollRef.current!);
          setError('Verification failed on the other side.');
          setStep('error');
        }
      } catch {}
    }, 1500);
  }

  const pulseStyle = { opacity: pulse };

  if (step === 'waiting') {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center px-8 gap-6">
          <Animated.View style={pulseStyle}>
            <PeerAvatar name={peerName} photoUrl={peerPhoto} size="large" />
          </Animated.View>
          <Text className="text-ink text-2xl font-bold text-center">{peerName}</Text>
          <Text className="text-muted text-base text-center">Waiting for them to respond...</Text>
          <ActivityIndicator color="#1A3A5C" />
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'incoming') {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 px-8 pb-12 justify-between">
          <View className="flex-1 items-center justify-center gap-6">
            <PeerAvatar name={peerName} photoUrl={peerPhoto} size="large" />
            <Text className="text-ink text-2xl font-bold text-center">{peerName}</Text>
            <Text className="text-muted text-base text-center">wants to verify with you</Text>
          </View>
          <View className="gap-3">
            <PrimaryButton label="Accept" onPress={handleAccept} />
            <PrimaryButton label="Decline" onPress={handleDecline} variant="ghost" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'auth') {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 px-8 pb-12 justify-between">
          <View className="flex-1 items-center justify-center gap-6">
            <PeerAvatar name={peerName} photoUrl={peerPhoto} size="large" />
            <Text className="text-ink text-2xl font-bold text-center">{peerName}</Text>
            <Text className="text-muted text-sm text-center">Verified identity</Text>
          </View>
          <PrimaryButton label="Verify with Face ID" onPress={handleAuth} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'face_check') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        <View className="absolute bottom-12 left-0 right-0 items-center px-8 gap-4">
          <Text className="text-white text-base font-semibold text-center"
            style={{ textShadowColor: '#000', textShadowRadius: 4 }}>
            Position your face in frame
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
        <Text className="text-ink text-xl font-semibold text-center">Checking identity...</Text>
      </SafeAreaView>
    );
  }

  if (step === 'peer_pending') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <Animated.View style={pulseStyle}>
          <PeerAvatar name={peerName} photoUrl={peerPhoto} size="small" />
        </Animated.View>
        <Text className="text-ink text-xl font-semibold text-center">
          Waiting for {peerName}...
        </Text>
        <ActivityIndicator color="#1A3A5C" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-4">
      <Text className="text-red-500 text-base text-center">{error}</Text>
      <PrimaryButton label="Try Again" onPress={() => setStep('auth')} />
      <PrimaryButton label="Cancel" onPress={() => router.replace('/home')} variant="ghost" />
    </SafeAreaView>
  );
}

function PeerAvatar({ name, photoUrl, size }: { name: string; photoUrl: string; size: 'small' | 'large' }) {
  const dim = size === 'large' ? 'w-32 h-32' : 'w-20 h-20';
  const text = size === 'large' ? 'text-5xl' : 'text-3xl';
  return (
    <View className={`${dim} rounded-full bg-surface items-center justify-center overflow-hidden`}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} className={dim} />
      ) : (
        <Text className={`${text} font-bold text-ink`}>{name?.[0] ?? '?'}</Text>
      )}
    </View>
  );
}
