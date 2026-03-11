import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import WebView from 'react-native-webview';

import { api } from '../../lib/api';
import { PrimaryButton } from '../../components/PrimaryButton';

type Step = 'idle' | 'liveness_loading' | 'liveness_webview' | 'finalizing' | 'active' | 'ending' | 'error';

export default function MeetHostScreen() {
  const [meetingCode, setMeetingCode] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  async function handleStart() {
    const code = meetingCode.trim();
    if (code.length < 3) {
      setError('Enter a meeting code (min 3 characters).');
      return;
    }
    setError('');
    setStep('liveness_loading');
    try {
      // 1. Create session
      const session = await api.meetStartSession(code);
      setSessionId(session.sessionId);
      setActiveCode(session.meetingCode);

      // 2. Join as a participant
      await api.meetJoin(session.meetingCode);

      // 3. Start meet-specific liveness (stores result in meetingAuthProgress)
      const { livenessSessionId: id } = await api.meetLivenessStart(session.sessionId);
      setLivenessSessionId(id);
      setStep('liveness_webview');
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
      setStep('error');
    }
  }

  async function handleLivenessComplete() {
    if (!livenessSessionId || !sessionId) return;
    setStep('finalizing');
    try {
      const liveness = await api.meetLivenessComplete(sessionId, livenessSessionId);
      if (!liveness.livenessPass || !liveness.faceMatchPassed) {
        // Clean up the session if host fails liveness
        await api.meetEndSession(sessionId).catch(() => {});
        setError(`Face verification failed (score: ${liveness.faceMatchScore?.toFixed(1) ?? 0}%). Please retry.`);
        setStep('error');
        return;
      }
      const result = await api.meetCompleteAuth(sessionId, { status: 'verified' });
      setExpiresAt(result.verificationExpiresAt ?? null);
      setStep('active');
    } catch (err: any) {
      await api.meetEndSession(sessionId!).catch(() => {});
      setError(err.message || 'Verification failed');
      setStep('error');
    }
  }

  async function handleEnd() {
    if (!sessionId) return;
    setStep('ending');
    try {
      await api.meetEndSession(sessionId);
    } catch {
      // ignore
    }
    setSessionId(null);
    setActiveCode(null);
    setLivenessSessionId(null);
    setStep('idle');
    setMeetingCode('');
  }

  async function handleCopyCode() {
    if (!activeCode) return;
    await Clipboard.setStringAsync(activeCode);
    Alert.alert('Copied', `${activeCode} copied to clipboard.`);
  }

  // Liveness WebView
  if (step === 'liveness_webview' && livenessSessionId && sessionId) {
    const livenessUrl =
      `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
      `?sessionId=${livenessSessionId}` +
      `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '')}` +
      `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1'}`;

    return (
      <View style={{ flex: 1 }}>
        <WebView
          source={{ uri: livenessUrl }}
          style={{ flex: 1 }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.done) handleLivenessComplete();
              else if (data.error) { setError(data.error); setStep('error'); }
            } catch {
              setError('Invalid liveness callback');
              setStep('error');
            }
          }}
          onError={(e) => { setError(`Liveness failed: ${e.nativeEvent.description}`); setStep('error'); }}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-6 pb-10 justify-between">
            <View>
              {step !== 'active' && (
                <TouchableOpacity onPress={() => router.back()} className="mb-6">
                  <Text className="text-navy text-base">← Back</Text>
                </TouchableOpacity>
              )}

              <Text className="text-ink text-3xl font-bold mb-2">Make a Meeting</Text>

              {step === 'active' && activeCode ? (
                <View className="gap-4 mt-4">
                  <View className="bg-success/10 rounded-xl p-4">
                    <Text className="text-success text-sm font-semibold mb-1">You are verified ✓</Text>
                    {expiresAt && (
                      <Text className="text-muted text-xs">
                        Valid until {new Date(expiresAt).toLocaleTimeString()}
                      </Text>
                    )}
                  </View>

                  <View className="bg-surface border border-border rounded-xl p-5">
                    <Text className="text-muted text-sm mb-1">Meeting Code</Text>
                    <Text className="text-ink text-2xl font-bold font-mono tracking-widest">{activeCode}</Text>
                    <Text className="text-muted text-sm mt-2">
                      Share this with participants — they enter it in the NAI app under "Join a Meeting".
                    </Text>
                  </View>
                </View>
              ) : (
                <View className="gap-4 mt-4">
                  <Text className="text-muted text-base">
                    You'll verify your identity before the session starts.
                  </Text>

                  {(step === 'idle' || step === 'error') && (
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
                      />
                      <Text className="text-muted text-xs mt-1">
                        Use any short identifier for this meeting.
                      </Text>
                    </View>
                  )}

                  {step === 'liveness_loading' && (
                    <Text className="text-muted text-base">Starting session and preparing liveness challenge...</Text>
                  )}

                  {step === 'finalizing' && (
                    <Text className="text-muted text-base">Verifying your identity...</Text>
                  )}

                  {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}
                </View>
              )}
            </View>

            <View className="gap-3 mt-8">
              {step === 'idle' && (
                <PrimaryButton label="Start & Verify Identity" onPress={handleStart} />
              )}
              {step === 'error' && (
                <>
                  <PrimaryButton label="Try Again" onPress={() => { setError(''); setStep('idle'); }} />
                  <PrimaryButton label="Back" variant="ghost" onPress={() => router.back()} />
                </>
              )}
              {step === 'active' && (
                <>
                  <PrimaryButton label="Copy Code" onPress={handleCopyCode} variant="outline" />
                  <PrimaryButton
                    label={step === 'ending' ? 'Ending...' : 'End Session'}
                    onPress={handleEnd}
                  />
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
