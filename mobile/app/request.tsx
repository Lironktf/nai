import { View, Text, TextInput, FlatList, TouchableOpacity, Image } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { api } from '../lib/api';

type UserResult = {
  id: string;
  legalName: string;
  userCode: string | null;
  photoUrl: string | null;
};

export default function Request() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch(text: string) {
    setQuery(text);
    if (text.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const data = await api.searchUsers(text);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelect(user: UserResult) {
    try {
      const { sessionId } = await api.requestVerification(user.id);
      router.push({ pathname: '/verify', params: { sessionId, peerName: user.legalName, peerPhoto: user.photoUrl ?? '' } });
    } catch (err: any) {
      alert(err.message || 'Failed to send request');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-6">
        <TouchableOpacity onPress={() => router.back()} className="mb-6">
          <Text className="text-navy text-base">← Back</Text>
        </TouchableOpacity>

        <Text className="text-ink text-3xl font-bold mb-6">Who are you meeting?</Text>

        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base mb-6"
          value={query}
          onChangeText={handleSearch}
          placeholder="Search by name, email, or code..."
          placeholderTextColor="#9CA3AF"
          autoFocus
        />

        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              className="flex-row items-center py-4 border-b border-border gap-4"
              onPress={() => handleSelect(item)}
            >
              <View className="w-12 h-12 rounded-full bg-surface items-center justify-center overflow-hidden">
                {item.photoUrl ? (
                  <Image source={{ uri: item.photoUrl }} className="w-12 h-12" />
                ) : (
                  <Text className="text-ink text-xl font-bold">
                    {item.legalName[0]}
                  </Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-ink text-base font-medium">{item.legalName}</Text>
                {item.userCode ? <Text className="text-muted text-xs">{item.userCode}</Text> : null}
              </View>
              <Text className="text-navy text-sm">Verify →</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            query.length >= 2 && !searching ? (
              <Text className="text-muted text-base text-center mt-8">No verified users found.</Text>
            ) : null
          }
        />
      </View>
    </SafeAreaView>
  );
}
