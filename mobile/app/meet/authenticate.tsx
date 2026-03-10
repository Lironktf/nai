import { useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import WebView from 'react-native-webview';

import { PrimaryButton } from '../../components/PrimaryButton';
import { api } from '../../lib/api';
import { assertMeetingPasskey } from '../../lib/passkey';

type Step = 'idle' | 'liveness_loading' | 'liveness_webview' | 'passkey' | 'finalizing' | 'done' | 'error';

export default function MeetAuthenticateScreen() {
  const { sessionId, meetingCode } = useLocalSearchParams<{ sessionId: string; meetingCode: string }>();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  if (!sessionId) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-6">
        <Text className="text-red-500 text-base text-center">Missing meeting session id.</Text>
      </SafeAreaView>
    );
  }

  async function beginAuth() {
    setError('');
    setStep('liveness_loading');
    try {
      const { livenessSessionId: id } = await api.meetLivenessStart(sessionId);
      setLivenessSessionId(id);
      setStep('liveness_webview');
    } catch (err: any) {
      setError(err.message || 'Failed to start liveness check');
      setStep('error');
    }
  }

  async function handleLivenessComplete() {
    if (!livenessSessionId) return;

    setStep('passkey');
    try {
      const liveness = await api.meetLivenessComplete(sessionId, livenessSessionId);
      if (!liveness.livenessPass || !liveness.faceMatchPassed) {
        await api.meetCompleteAuth(sessionId, {
          status: 'failed',
          failureReason: 'Liveness or face match did not pass',
        });
        setError('Liveness or face match failed. Please retry.');
        setStep('error');
        return;
      }

      await assertMeetingPasskey(sessionId);

      setStep('finalizing');
      const result = await api.meetCompleteAuth(sessionId, { status: 'verified' });
      setExpiresAt(result.verificationExpiresAt ?? null);
      setStep('done');
    } catch (err: any) {
      await api.meetCompleteAuth(sessionId, {
        status: 'failed',
        failureReason: err?.message || 'Authentication failed',
      }).catch(() => {});
      setError(err.message || 'Authentication failed');
      setStep('error');
    }
  }

  if (step === 'liveness_webview' && livenessSessionId) {
    const livenessUrl =
      `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
      `?sessionId=${livenessSessionId}` +
      `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '')}` +
      `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1'}`;

    return (
      <View style={{ flex: 1 }}>
        <WebView
          source={{ uri: livenessUrl }}
          style={{ flex: 1 }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.done) {
                handleLivenessComplete();
              } else if (data.error) {
                setError(data.error);
                setStep('error');
              }
            } catch {
              setError('Invalid liveness callback');
              setStep('error');
            }
          }}
          onError={(e) => {
            setError(`Liveness page failed: ${e.nativeEvent.description}`);
            setStep('error');
          }}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-8 pb-10 justify-between">
        <View className="gap-5">
          <Text className="text-ink text-3xl font-bold">Authenticate for Meet</Text>
          <Text className="text-muted text-base">
            Meeting code: <Text className="text-ink font-semibold">{meetingCode}</Text>
          </Text>

          {step === 'idle' && (
            <Text className="text-muted text-base">
              You will complete liveness + face match, then confirm with your passkey.
            </Text>
          )}

          {(step === 'liveness_loading' || step === 'passkey' || step === 'finalizing') && (
            <View className="items-center mt-6">
              <ActivityIndicator size="large" color="#1A3A5C" />
              <Text className="text-muted text-base mt-3">
                {step === 'liveness_loading' && 'Preparing liveness challenge...'}
                {step === 'passkey' && 'Complete passkey verification on your device...'}
                {step === 'finalizing' && 'Finalizing verification status...'}
              </Text>
            </View>
          )}

          {step === 'done' && (
            <View className="bg-success/10 rounded-xl p-4">
              <Text className="text-success text-base font-semibold mb-1">Verified</Text>
              <Text className="text-muted text-sm">
                {expiresAt ? `Valid until ${new Date(expiresAt).toLocaleTimeString()}` : 'Verification completed.'}
              </Text>
            </View>
          )}

          {step === 'error' && (
            <View className="bg-red-50 rounded-xl p-4">
              <Text className="text-red-500 text-sm">{error}</Text>
            </View>
          )}
        </View>

        <View className="gap-3">
          {step === 'idle' && (
            <PrimaryButton label="Start Authentication" onPress={beginAuth} />
          )}

          {step === 'error' && (
            <PrimaryButton
              label="Try Again"
              onPress={() => {
                setError('');
                setStep('idle');
              }}
            />
          )}

          {(step === 'done' || step === 'error') && (
            <PrimaryButton label="Back to Home" variant="ghost" onPress={() => router.replace('/home')} />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
