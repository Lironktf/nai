import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { PrimaryButton } from '../components/PrimaryButton';
import { registerPasskey } from '../lib/passkey';
import { api } from '../lib/api';

export default function PasskeyScreen() {
  const [step, setStep] = useState<'idle' | 'registering' | 'bypassing' | 'error'>('idle');
  const [error, setError] = useState('');
  const [showBypass, setShowBypass] = useState(false);

  async function handleRegister() {
    setStep('registering');
    setError('');
    setShowBypass(false);
    try {
      await registerPasskey();
      router.replace('/home');
    } catch (err: any) {
      setError(err?.message || 'Passkey not available — use dev bypass below.');
      if (__DEV__) setShowBypass(true);
      setStep('error');
    }
  }

  async function handleBypass() {
    setStep('bypassing');
    setError('');
    try {
      await api.passkeyRegisterBypass();
      router.replace('/home');
    } catch (err: any) {
      setError(err.message || 'Bypass failed');
      setStep('error');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-8 pb-12 justify-between">
        <View className="flex-1 items-center justify-center">
          <View className="w-24 h-24 rounded-full bg-surface items-center justify-center mb-8">
            <Text className="text-5xl">🔒</Text>
          </View>

          <Text className="text-ink text-3xl font-bold text-center mb-4">
            Register your face
          </Text>
          <Text className="text-muted text-base text-center leading-relaxed">
            Your device will create a secure passkey using Face ID (or fingerprint). This is what
            proves it's you — every time you verify.
          </Text>

          {step === 'error' && (
            <Text className="text-red-500 text-sm mt-6 text-center">{error}</Text>
          )}
        </View>

        <View className="gap-3">
          <PrimaryButton
            label={step === 'registering' ? 'Registering...' : 'Register Face ID'}
            onPress={handleRegister}
            disabled={step === 'registering' || step === 'bypassing'}
          />
          {showBypass && __DEV__ && (
            <PrimaryButton
              label={step === 'bypassing' ? 'Activating...' : 'Skip — Dev bypass (Expo Go)'}
              variant="ghost"
              onPress={handleBypass}
              disabled={step === 'bypassing'}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
