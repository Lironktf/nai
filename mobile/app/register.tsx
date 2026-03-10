import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';
import { saveToken } from '../lib/storage';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legalName, setLegalName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setError('');
    setLoading(true);
    try {
      const { token } = await api.register(email.trim(), password, legalName.trim() || undefined, phone.trim() || undefined);
      await saveToken(token);
      router.replace('/kyc');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 px-8 pt-12 pb-8 justify-between" style={{ minHeight: '100%' }}>
            <View>
              <TouchableOpacity onPress={() => router.back()} className="mb-10">
                <Text className="text-navy text-base">← Back</Text>
              </TouchableOpacity>
              <Text className="text-ink text-3xl font-bold mb-2">Create account</Text>
              <Text className="text-muted text-base mb-10">
                You'll verify your identity in the next step.
              </Text>

              <View className="gap-4">
                <View>
                  <Text className="text-ink text-sm font-medium mb-2">Full name</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
                    value={legalName}
                    onChangeText={setLegalName}
                    autoComplete="name"
                    placeholder="Jane Smith (optional)"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View>
                  <Text className="text-ink text-sm font-medium mb-2">Phone</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    placeholder="+1 555 000 0000 (optional)"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View>
                  <Text className="text-ink text-sm font-medium mb-2">Email</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    placeholder="you@example.com"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View>
                  <Text className="text-ink text-sm font-medium mb-2">Password</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="oneTimeCode"
                    placeholder="Minimum 8 characters"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}
              </View>
            </View>

            <View className="mt-8">
              <PrimaryButton
                label={loading ? 'Creating account...' : 'Continue'}
                onPress={handleRegister}
                disabled={loading}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
