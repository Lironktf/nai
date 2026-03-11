import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { api } from '../../lib/api';
import { PrimaryButton } from '../../components/PrimaryButton';

type State = 'idle' | 'loading' | 'active' | 'ending';

export default function MeetHostScreen() {
  const [meetingCode, setMeetingCode] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');

  async function handleStart() {
    const code = meetingCode.trim();
    if (code.length < 3) {
      setError('Enter a meeting code (min 3 characters).');
      return;
    }
    setError('');
    setState('loading');
    try {
      const session = await api.meetStartSession(code);
      setSessionId(session.sessionId);
      setActiveCode(session.meetingCode);
      setState('active');
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
      setState('idle');
    }
  }

  async function handleEnd() {
    if (!sessionId) return;
    setState('ending');
    try {
      await api.meetEndSession(sessionId);
    } catch {
      // ignore — session may already be ended
    }
    setSessionId(null);
    setActiveCode(null);
    setState('idle');
    setMeetingCode('');
  }

  async function handleCopyCode() {
    if (!activeCode) return;
    await Clipboard.setStringAsync(activeCode);
    Alert.alert('Copied', `Meeting code ${activeCode} copied to clipboard.`);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-6 pb-10 justify-between">
            <View>
              <TouchableOpacity onPress={() => router.back()} className="mb-6">
                <Text className="text-navy text-base">← Back</Text>
              </TouchableOpacity>

              <Text className="text-ink text-3xl font-bold mb-2">Make a Meeting</Text>
              <Text className="text-muted text-base mb-8">
                Start a verification session for your Google Meet call.
              </Text>

              {state === 'active' && activeCode ? (
                <View className="gap-4">
                  <View className="bg-surface border border-border rounded-xl p-5">
                    <Text className="text-muted text-sm mb-1">Meeting Code</Text>
                    <Text className="text-ink text-2xl font-bold font-mono tracking-widest">{activeCode}</Text>
                    <Text className="text-muted text-sm mt-2">
                      Share this code with participants — they enter it in the NAI app.
                    </Text>
                  </View>

                  <PrimaryButton label="Copy Code" onPress={handleCopyCode} variant="outline" />

                  <View className="bg-success/10 rounded-xl p-4">
                    <Text className="text-success text-sm font-semibold">Session active</Text>
                    <Text className="text-muted text-sm mt-1">
                      Participants can now join and verify their identity.
                    </Text>
                  </View>
                </View>
              ) : (
                <View className="gap-4">
                  <View>
                    <Text className="text-ink text-sm font-medium mb-2">Meeting Code</Text>
                    <TextInput
                      value={meetingCode}
                      onChangeText={setMeetingCode}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      placeholder="e.g. DAILY-STANDUP"
                      placeholderTextColor="#9CA3AF"
                      className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base"
                      editable={state === 'idle'}
                    />
                    <Text className="text-muted text-xs mt-1">
                      Use any short code that matches your meeting (e.g. the Google Meet room code).
                    </Text>
                  </View>

                  {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}
                </View>
              )}
            </View>

            <View className="gap-3 mt-8">
              {state !== 'active' ? (
                <PrimaryButton
                  label={state === 'loading' ? 'Starting...' : 'Start Session'}
                  onPress={handleStart}
                  disabled={state === 'loading'}
                />
              ) : (
                <PrimaryButton
                  label={state === 'ending' ? 'Ending...' : 'End Session'}
                  onPress={handleEnd}
                  disabled={state === 'ending'}
                />
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
