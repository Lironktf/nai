import { View, Text, Image, ActivityIndicator, Animated } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import WebView from 'react-native-webview';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';
import { assertPasskey } from '../lib/passkey';

type VerifyStep =
  | 'waiting'
  | 'incoming'
  | 'auth'
  | 'liveness_loading'  // fetching liveness sessionId from server
  | 'liveness_webview'  // WebView running FaceLivenessDetector
  | 'checking'          // server evaluating liveness + face match
  | 'peer_pending'
  | 'error';

export default function Verify() {
  const { sessionId, peerName, peerPhoto, mode, devBypass } = useLocalSearchParams<{
    sessionId: string;
    peerName: string;
    peerPhoto: string;
    mode: 'outgoing' | 'incoming';
    devBypass: string;
  }>();
  const isDevBypass = devBypass === '1';

  const [step, setStep] = useState<VerifyStep>(mode === 'incoming' ? 'incoming' : 'waiting');
  const [error, setError] = useState('');
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(null);
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
    if (isDevBypass) {
      setStep('checking');
      await handleBypassAssert();
      return;
    }
    setStep('liveness_loading');
    try {
      const { sessionId: lsid } = await api.livenessStart();
      setLivenessSessionId(lsid);
      setStep('liveness_webview');
    } catch (err: any) {
      setError(err.message || 'Failed to start liveness check');
      setStep('error');
    }
  }

  async function handleLivenessComplete() {
    if (!livenessSessionId) return;
    setStep('checking');
    try {
      const { livenessPass, livenessConfidence, faceMatchPassed, faceMatchScore } =
        await api.livenessComplete(livenessSessionId);

      if (!livenessPass) {
        setError(
          `Liveness check failed (confidence: ${livenessConfidence?.toFixed(1)}%). ` +
          'Ensure you are in good lighting and face the camera directly.'
        );
        setStep('error');
        return;
      }
      if (!faceMatchPassed) {
        setError(
          `Face does not match your profile (score: ${faceMatchScore?.toFixed(1)}%). ` +
          'Please try again in better lighting.'
        );
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

  async function handleBypassAssert() {
    try {
      const { verificationCode, state } = await api.testAssertBypass(sessionId);
      if (state === 'verified' && verificationCode) {
        router.replace({ pathname: '/confirmed', params: { peerName, code: verificationCode } });
      } else {
        startPollingForCompletion();
      }
    } catch (err: any) {
      setError(err.message || 'Bypass failed');
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

  if (step === 'liveness_loading') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center gap-4">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-ink text-base font-semibold">Preparing liveness check...</Text>
      </SafeAreaView>
    );
  }

  if (step === 'liveness_webview' && livenessSessionId) {
    const livenessUrl =
      `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
      `?sessionId=${livenessSessionId}` +
      `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '')}` +
      `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1'}`;

    // Inject JS to catch any unhandled errors and report back via postMessage.
    const errorCaptureJS = `
      window.onerror = function(msg, src, line, col, err) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ jsError: msg + ' (' + src + ':' + line + ')' })
        );
        return false;
      };
      window.addEventListener('unhandledrejection', function(e) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ jsError: 'Unhandled promise: ' + (e.reason || e) })
        );
      });
      true;
    `;

    return (
      <View style={{ flex: 1 }}>
        <WebView
          source={{ uri: livenessUrl }}
          style={{ flex: 1 }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          injectedJavaScriptBeforeContentLoaded={errorCaptureJS}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.done) {
                handleLivenessComplete();
              } else if (data.error) {
                setError(data.error);
                setStep('error');
              } else if (data.jsError) {
                // Surface JS errors from inside the WebView
                setError(`WebView JS error: ${data.jsError}`);
                setStep('error');
              }
            } catch {}
          }}
          onHttpError={(e) => {
            setError(`Page load failed: HTTP ${e.nativeEvent.statusCode}`);
            setStep('error');
          }}
          onError={(e) => {
            setError(`Failed to load liveness page: ${e.nativeEvent.description}`);
            setStep('error');
          }}
        />
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
