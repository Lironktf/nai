import { View, Text, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  withSpring,
  withDelay,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { PrimaryButton } from '../components/PrimaryButton';

export default function Confirmed() {
  const { peerName, code } = useLocalSearchParams<{ peerName: string; code: string }>();
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 200 });
    opacity.value = withDelay(300, withTiming(1, { duration: 400 }));
  }, []);

  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  async function copyCode() {
    await Clipboard.setStringAsync(code);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 items-center justify-between px-8 pb-12 pt-16">
        <View className="items-center gap-6">
          {/* Checkmark */}
          <Animated.View
            style={checkStyle}
            className="w-24 h-24 rounded-full bg-success items-center justify-center"
          >
            <Text className="text-white text-5xl">✓</Text>
          </Animated.View>

          <Animated.View style={contentStyle} className="items-center gap-2">
            <Text className="text-ink text-3xl font-bold text-center">{peerName}</Text>
            <Text className="text-success text-lg font-semibold">Verified</Text>
            <Text className="text-muted text-sm mt-1">
              {new Date().toLocaleString()}
            </Text>
          </Animated.View>

          {/* Verification code */}
          <Animated.View style={contentStyle} className="mt-4 items-center gap-2">
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
