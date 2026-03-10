import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import { api } from '../lib/api';

type KycStep = 'loading' | 'persona' | 'error';

export default function Kyc() {
  const [step, setStep] = useState<KycStep>('loading');
  const [inquiryUrl, setInquiryUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advancedRef = useRef(false);

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
      // Poll the server — when Persona's webhook fires and updates the user's
      // status, we auto-advance. No WebView event bridge needed.
      pollRef.current = setInterval(async () => {
        try {
          const { status } = await api.kycStatus();
          if (['pending_video', 'pending_passkey', 'active'].includes(status)) {
            if (advancedRef.current) return;
            advancedRef.current = true;
            clearInterval(pollRef.current!);
            router.replace('/passkey');
          }
        } catch {
          // keep polling
        }
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      setStep('error');
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

  if (step === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center px-8">
        <Text className="text-red-500 text-base text-center">{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WebView source={{ uri: inquiryUrl }} style={{ flex: 1 }} />
    </SafeAreaView>
  );
}
