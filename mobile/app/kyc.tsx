import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import { api } from '../lib/api';
import { PrimaryButton } from '../components/PrimaryButton';

type KycStep = 'loading' | 'persona' | 'processing' | 'timeout' | 'error';

// Persona's hosted flow redirects / shows completion at these URL patterns.
const PERSONA_DONE_PATTERNS = ['/complete', '/completed', 'status=completed', 'status=approved', '/success'];

export default function Kyc() {
  const [step, setStep] = useState<KycStep>('loading');
  const [inquiryUrl, setInquiryUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedRef = useRef(false);

  useEffect(() => {
    startKyc();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function startKyc() {
    try {
      const { inquiryId, sessionToken } = await api.mobileKycStart();
      setInquiryUrl(
        `https://withpersona.com/verify?inquiry-id=${inquiryId}&session-token=${sessionToken}`
      );
      setStep('persona');
      startPolling();
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      setStep('error');
    }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~2 min at 3s intervals

    pollRef.current = setInterval(async () => {
      try {
        const { status } = await api.kycStatus();
        if (['pending_video', 'pending_passkey', 'active'].includes(status)) {
          if (advancedRef.current) return;
          advancedRef.current = true;
          clearInterval(pollRef.current!);
          router.replace('/face-verify');
          return;
        }
      } catch {
        // keep polling
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(pollRef.current!);
        setStep('timeout');
      }
    }, 3000);
  }

  async function startProcessing() {
    if (advancedRef.current) return;
    setStep('processing');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // First: actively ask the server to check Persona's API directly.
    // This handles the sandbox case where inquiry.approved webhook never fires.
    try {
      const { status } = await api.kycSync();
      if (['pending_video', 'pending_passkey', 'active'].includes(status)) {
        advancedRef.current = true;
        router.replace('/face-verify');
        return;
      }
    } catch {
      // sync failed — fall through to polling
    }

    // Fallback: poll in case the webhook arrives shortly after
    startPolling();
  }

  async function handleRetry() {
    advancedRef.current = false;
    startProcessing();
  }

  function handleWebViewNavigation(navState: { url: string }) {
    const url = navState.url ?? '';
    if (PERSONA_DONE_PATTERNS.some((p) => url.includes(p))) {
      startProcessing();
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

  if (step === 'processing') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <ActivityIndicator size="large" color="#1A3A5C" />
        <Text className="text-ink text-xl font-semibold text-center">Processing your verification...</Text>
        <Text className="text-muted text-sm text-center">This usually takes under a minute.</Text>
      </SafeAreaView>
    );
  }

  if (step === 'timeout') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8 gap-6">
        <Text className="text-ink text-xl font-semibold text-center">Still processing</Text>
        <Text className="text-muted text-sm text-center">
          Verification is taking longer than expected. Tap below to check again.
        </Text>
        <PrimaryButton label="Check again" onPress={handleRetry} />
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

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WebView
        source={{ uri: inquiryUrl }}
        style={{ flex: 1 }}
        onNavigationStateChange={handleWebViewNavigation}
      />
    </SafeAreaView>
  );
}
