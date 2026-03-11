// PASSKEY REGISTRATION — NOT IN ACTIVE FLOW
//
// How passkeys work:
//   1. Server generates a WebAuthn registration challenge (rpId = nai.lironkatsif.com)
//   2. react-native-passkey calls iOS/Android platform API with the challenge
//   3. iOS shows a Face ID prompt, creates a key pair in the Secure Enclave
//      (private key NEVER leaves the device), sends public key to server
//   4. Server stores public key in webauthn_credentials, sets status = 'active'
//   5. At verification time, server generates an auth challenge; user does Face ID
//      which signs the challenge with the private key; server verifies the signature
//
// Prerequisites to re-enable:
//   - APPLE_TEAM_ID filled in server .env (developer.apple.com → Membership)
//   - Rebuild the app after adding associatedDomains to app.json (already done)
//   - Change router.replace('/face-verify') back to router.replace('/passkey') in kyc.tsx
//
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { PrimaryButton } from '../components/PrimaryButton';
import { registerPasskey } from '../lib/passkey';

export default function PasskeyScreen() {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setRegistering(true);
    setError('');
    try {
      await registerPasskey();
      router.replace('/home');
    } catch (err: any) {
      // Include the native error code if available (helps debug domain/AASA issues)
      const code = err?.code != null ? ` (code ${err.code})` : '';
      setError((err?.message || 'Registration failed') + code);
      console.error('[passkey] registration error:', err);
    } finally {
      setRegistering(false);
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

          {!!error && (
            <Text className="text-red-500 text-sm mt-6 text-center">{error}</Text>
          )}
        </View>

        <PrimaryButton
          label={registering ? 'Registering...' : 'Register Face ID'}
          onPress={handleRegister}
          disabled={registering}
        />
      </View>
    </SafeAreaView>
  );
}
