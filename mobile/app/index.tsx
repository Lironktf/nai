import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { getToken } from '../lib/storage';
import { useEffect } from 'react';

export default function Welcome() {
  useEffect(() => {
    // If already logged in, go to home
    getToken().then((token) => {
      if (token) router.replace('/home');
    });
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 justify-between px-8 pb-12 pt-24">
        {/* Logo / wordmark */}
        <View className="items-center">
          <View className="w-16 h-16 rounded-2xl bg-navy items-center justify-center mb-6">
            <Text className="text-white text-2xl font-bold">TH</Text>
          </View>
          <Text className="text-ink text-4xl font-bold tracking-tight">TrustHandshake</Text>
          <Text className="text-muted text-base mt-3 text-center leading-relaxed">
            Mutual identity verification.{'\n'}Know exactly who you're talking to.
          </Text>
        </View>

        {/* Actions */}
        <View className="gap-4">
          <PrimaryButton label="Get Started" onPress={() => router.push('/register')} />
          <PrimaryButton
            label="Sign In"
            onPress={() => router.push('/login')}
            variant="outline"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
