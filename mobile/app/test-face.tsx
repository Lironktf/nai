import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import WebView from 'react-native-webview';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';

type Step = 'idle' | 'loading' | 'liveness_webview' | 'checking' | 'result' | 'error';

export default function TestFace() {
  const [step, setStep] = useState<Step>('idle');
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    livenessPass: boolean;
    livenessConfidence: number;
    faceMatchPassed: boolean;
    faceMatchScore: number;
  } | null>(null);
  const [error, setError] = useState('');

  async function handleStart() {
    setError('');
    setStep('loading');
    try {
      const { sessionId } = await api.livenessStart();
      setLivenessSessionId(sessionId);
      setStep('liveness_webview');
    } catch (err: any) {
      setError(err.message || 'Failed to start liveness session');
      setStep('error');
    }
  }

  async function handleLivenessComplete() {
    if (!livenessSessionId) return;
    setStep('checking');
    try {
      const res = await api.livenessComplete(livenessSessionId);
      setResult(res);
      setStep('result');
    } catch (err: any) {
      setError(err.message || 'Liveness check failed');
      setStep('error');
    }
  }

  if (step === 'liveness_webview' && livenessSessionId) {
    const livenessUrl =
      `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
      `?sessionId=${livenessSessionId}` +
      `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '')}` +
      `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1'}`;

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

  return (
    <SafeAreaView className="flex-1 bg-bg items-center justify-center px-6 gap-6">
      {step === 'idle' && (
        <>
          <Text className="text-ink text-xl font-bold text-center">Test Face Liveness</Text>
          <Text className="text-muted text-sm text-center">
            Runs the full AWS liveness challenge + face match against your profile photo.
          </Text>
          <PrimaryButton label="Start Liveness Check" onPress={handleStart} />
          <PrimaryButton label="Back" onPress={() => router.back()} variant="ghost" />
        </>
      )}

      {step === 'loading' && (
        <>
          <ActivityIndicator size="large" color="#1A3A5C" />
          <Text className="text-ink text-base font-semibold">Preparing liveness check...</Text>
        </>
      )}

      {step === 'checking' && (
        <>
          <ActivityIndicator size="large" color="#1A3A5C" />
          <Text className="text-ink text-base font-semibold">Evaluating results...</Text>
        </>
      )}

      {step === 'result' && result && (
        <View className="w-full gap-4">
          <Text className="text-ink text-xl font-bold text-center">Results</Text>

          <View className="bg-surface rounded-2xl p-5 gap-3">
            <ResultRow
              label="Liveness"
              value={result.livenessPass ? '✓ Pass' : '✗ Fail'}
              pass={result.livenessPass}
              sub={`Confidence: ${result.livenessConfidence.toFixed(1)}%  (threshold: 90%)`}
            />
            <View className="h-px bg-border" />
            <ResultRow
              label="Face Match"
              value={result.faceMatchPassed ? '✓ Match' : '✗ No Match'}
              pass={result.faceMatchPassed}
              sub={`Score: ${result.faceMatchScore.toFixed(1)}%  (threshold: 85%)`}
            />
          </View>

          <PrimaryButton label="Run Again" onPress={handleStart} />
          <PrimaryButton label="Done" onPress={() => router.back()} variant="ghost" />
        </View>
      )}

      {step === 'error' && (
        <View className="w-full gap-4 items-center">
          <Text className="text-red-500 text-base text-center">{error}</Text>
          <PrimaryButton label="Try Again" onPress={handleStart} />
          <PrimaryButton label="Back" onPress={() => router.back()} variant="ghost" />
        </View>
      )}
    </SafeAreaView>
  );
}

function ResultRow({ label, value, pass, sub }: { label: string; value: string; pass: boolean; sub: string }) {
  return (
    <View className="gap-1">
      <View className="flex-row justify-between items-center">
        <Text className="text-muted text-sm">{label}</Text>
        <Text className={`text-base font-bold ${pass ? 'text-success' : 'text-red-500'}`}>{value}</Text>
      </View>
      <Text className="text-muted text-xs">{sub}</Text>
    </View>
  );
}
