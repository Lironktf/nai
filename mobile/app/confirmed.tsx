import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import { PrimaryButton } from '../components/PrimaryButton';

export default function Confirmed() {
  const { peerName, code } = useLocalSearchParams<{ peerName: string; code: string }>();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, damping: 12, stiffness: 200, useNativeDriver: true }).start();
    Animated.delay(300).start(() =>
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    );
  }, []);

  async function copyCode() {
    await Clipboard.setStringAsync(code);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 items-center justify-between px-8 pb-12 pt-16">
        <View className="items-center gap-6">
          {/* Checkmark */}
          <Animated.View
            style={{ transform: [{ scale }] }}
            className="w-24 h-24 rounded-full bg-success items-center justify-center"
          >
            <Text className="text-white text-5xl">✓</Text>
          </Animated.View>

          <Animated.View style={{ opacity }} className="items-center gap-2">
            <Text className="text-ink text-3xl font-bold text-center">{peerName}</Text>
            <Text className="text-success text-lg font-semibold">Verified</Text>
            <Text className="text-muted text-sm mt-1">
              {new Date().toLocaleString()}
            </Text>
          </Animated.View>

          {/* Verification code */}
          <Animated.View style={{ opacity }} className="mt-4 items-center gap-2">
            <Text className="text-muted text-xs uppercase tracking-widest">Verification Code</Text>
            <TouchableOpacity
              onPress={copyCode}
              className="bg-surface border border-border rounded-xl px-6 py-3"
            >
              <Text className="text-ink text-xl font-mono font-bold tracking-wider">{code}</Text>
            </TouchableOpacity>
            <Text className="text-muted text-xs">Tap to copy</Text>
          </Animated.View>
        </View>

        <PrimaryButton label="Done" onPress={() => router.replace('/home')} />
      </View>
    </SafeAreaView>
  );
}
