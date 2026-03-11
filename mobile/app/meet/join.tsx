import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../lib/api';
import { PrimaryButton } from '../../components/PrimaryButton';

export default function MeetJoinScreen() {
  const [meetingCode, setMeetingCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    setError('');
    const code = meetingCode.trim();
    if (code.length < 3) {
      setError('Enter a valid meeting code.');
      return;
    }

    setLoading(true);
    try {
      const joined = await api.meetJoin(code, displayName.trim() || undefined);
      router.push({
        pathname: '/meet/authenticate',
        params: {
          sessionId: joined.sessionId,
          meetingCode: joined.meetingCode,
        },
      });
    } catch (err: any) {
      setError(err.message || 'Could not join meeting session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
      <View className="flex-1 px-6 pt-6 pb-10 justify-between">
        <View>
          <TouchableOpacity onPress={() => router.back()} className="mb-6">
            <Text className="text-navy text-base">← Back</Text>
          </TouchableOpacity>

          <Text className="text-ink text-3xl font-bold mb-2">Join Meet Verification</Text>
          <Text className="text-muted text-base mb-8">
            Enter the meeting code from the host’s NAI side panel.
          </Text>

          <View className="gap-4">
            <View>
              <Text className="text-ink text-sm font-medium mb-2">Meeting Code</Text>
              <TextInput
                value={meetingCode}
                onChangeText={setMeetingCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABC-123"
                placeholderTextColor="#9CA3AF"
                className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
              />
            </View>

            <View>
              <Text className="text-ink text-sm font-medium mb-2">Your Meeting Name (optional)</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                placeholder="Name shown in Google Meet"
                placeholderTextColor="#9CA3AF"
                className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
              />
            </View>

            {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}
          </View>
        </View>

        <PrimaryButton
          label={loading ? 'Joining...' : 'Continue to Authentication'}
          onPress={handleJoin}
          disabled={loading}
        />
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
