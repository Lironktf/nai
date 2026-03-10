import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { PrimaryButton } from '../components/PrimaryButton';
import { api } from '../lib/api';
import { clearToken } from '../lib/storage';

type RecentVerification = {
  id: string;
  peerName: string;
  verifiedAt: string;
  code: string;
};

export default function Home() {
  const [user, setUser] = useState<{ legalName: string; email: string } | null>(null);
  const [recent, setRecent] = useState<RecentVerification[]>([]);

  useEffect(() => {
    api.me().then(setUser).catch(() => {});
    api.recentVerifications().then(setRecent).catch(() => {});
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-6">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-10">
          <View>
            <Text className="text-muted text-sm">Verified identity</Text>
            <View className="flex-row items-center gap-2 mt-1">
              <Text className="text-ink text-xl font-bold">
                {user?.legalName ?? user?.email ?? '—'}
              </Text>
              <View className="bg-success/10 rounded-full px-2 py-0.5">
                <Text className="text-success text-xs font-semibold">✓ Verified</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity onPress={async () => { await clearToken(); router.replace('/'); }}>
            <Text className="text-muted text-sm">Sign out</Text>
          </TouchableOpacity>
        </View>

        {/* Primary actions */}
        <PrimaryButton
          label="Join Meet Verification"
          onPress={() => router.push('/meet/join')}
        />

        <PrimaryButton
          label="Request Verification"
          variant="outline"
          onPress={() => router.push('/request')}
        />

        {/* Dev-only test buttons */}
        {__DEV__ && (
          <PrimaryButton
            label="Test Face Match (Rekognition)"
            variant="ghost"
            onPress={() => router.push('/test-face')}
          />
        )}
        <PrimaryButton
          label="Test Verification (Dev)"
          variant="ghost"
          onPress={async () => {
            try {
              const { sessionId, peerName, peerPhoto } = await api.testStartSession();
              router.push({
                pathname: '/verify',
                params: { sessionId, peerName, peerPhoto: peerPhoto ?? '', mode: 'outgoing', devBypass: '1' },
              });
            } catch (err: any) {
              alert(err.message || 'Failed to start test session');
            }
          }}
        />

        {/* Recent verifications */}
        <Text className="text-ink text-lg font-semibold mt-10 mb-4">Recent</Text>

        {recent.length === 0 ? (
          <Text className="text-muted text-base text-center mt-8">
            No verifications yet.{"\n"}Request one to get started.
          </Text>
        ) : (
          <FlatList
            data={recent}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity className="flex-row justify-between items-center py-4 border-b border-border">
                <View>
                  <Text className="text-ink text-base font-medium">{item.peerName}</Text>
                  <Text className="text-muted text-sm mt-0.5">
                    {new Date(item.verifiedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Text className="text-muted text-xs font-mono">{item.code}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
