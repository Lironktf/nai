import { io } from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function createMeetSocket(token) {
  return io(BASE, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  });
}
