import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { api } from '../lib/api';

type KycStep = 'loading' | 'persona' | 'polling' | 'error';

// Injected into the WebView page — forwards Persona's window.postMessage
// events to the React Native layer via window.ReactNativeWebView.postMessage.
const PERSONA_MESSAGE_BRIDGE = `
  (function() {
    var _orig = window.postMessage.bind(window);
    window.addEventListener('message', function(e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          typeof e.data === 'string' ? e.data : JSON.stringify(e.data)
        );
      }
    });
  })();
  true;
`;

export default function Kyc() {
  const [step, setStep] = useState<KycStep>('loading');
  const [inquiryUrl, setInquiryUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    startKyc();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startKyc() {
    try {
      const { inquiryId, sessionToken } = await api.mobileKycStart();
      setInquiryUrl(
        `https://withpersona.com/verify?inquiry-id=${inquiryId}&session-token=${sessionToken}`
      );
      setStep('persona');
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      setStep('error');
    }
  }

  function handlePersonaComplete() {
    if (completedRef.current) return;
    completedRef.current = true;
    setStep('polling');
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await api.kycStatus();
        if (['pending_video', 'pending_passkey', 'active'].includes(status)) {
          clearInterval(pollRef.current!);
          router.replace('/passkey');
        }
      } catch {
        // keep polling
      }
    }, 2000);
  }

  // Handle Persona's postMessage events forwarded from the WebView bridge.
  function handleWebViewMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const name: string = data?.name ?? data?.type ?? '';
      if (
        name.includes('complete') ||
        name.includes('approved') ||
        name.includes('success')
      ) {
        handlePersonaComplete();
      }
    } catch {
      // non-JSON message — ignore
    }
  }

  if (step === 'loading') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-muted mt-4 text-base">Preparing identity verification...</Text>
      </SafeAreaView>
    );
  }

  if (step === 'polling') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-ink text-2xl font-bold mt-6 text-center">Verifying your identity</Text>
        <Text className="text-muted text-base mt-3 text-center">
          Your documents are being reviewed.{'\n'}This usually takes less than a minute.
        </Text>
      </SafeAreaView>
    );
  }

  if (step === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8">
        <Text className="text-red-500 text-base text-center">{error}</Text>
      </SafeAreaView>
    );
  }

  // Persona WebView
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WebView
        source={{ uri: inquiryUrl }}
        injectedJavaScript={PERSONA_MESSAGE_BRIDGE}
        onMessage={handleWebViewMessage}
        onNavigationStateChange={(state) => {
          // URL-based fallback — catches redirect-style completions
          const url = state.url ?? '';
          if (
            url.includes('persona.com/complete') ||
            url.includes('status=completed') ||
            url.includes('status=approved') ||
            url.includes('/done') ||
            url.includes('/complete')
          ) {
            handlePersonaComplete();
          }
        }}
        style={{ flex: 1 }}
      />
    </SafeAreaView>
  );
}
