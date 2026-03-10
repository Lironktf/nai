import '../global.css';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Amplify } from 'aws-amplify';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../lib/storage';

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '',
      allowGuestAccess: true,
    },
  },
});

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function RootLayout() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let socket: Socket;

    getToken().then((token) => {
      if (!token) return;

      socket = io(BASE, { auth: { token }, transports: ['polling', 'websocket'] });
      socketRef.current = socket;

      socket.on('verification:incoming', ({ sessionId, requesterName, requesterPhoto }) => {
        router.push({
          pathname: '/verify',
          params: {
            sessionId,
            peerName: requesterName,
            peerPhoto: requesterPhoto ?? '',
            mode: 'incoming',
          },
        });
      });
    });

    return () => { socket?.disconnect(); };
  }, []);

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
