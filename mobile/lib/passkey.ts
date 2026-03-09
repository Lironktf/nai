import { api } from './api';

// react-native-passkey requires a native build (linked CocoaPods / Gradle).
// In Expo Go it is not available, so we load it lazily and throw a clear error
// if the native module is missing rather than crashing at import time.
function getPasskey() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Passkey } = require('react-native-passkey');
    if (!Passkey?.create) throw new Error('Native module not linked');
    return Passkey;
  } catch {
    throw new Error(
      'Passkey native module is not available in Expo Go. Build with `expo run:ios` to use this feature.'
    );
  }
}

// Register a new passkey during enrollment.
export async function registerPasskey(): Promise<void> {
  const Passkey = getPasskey();
  const { challengeOptions } = await api.passkeyRegisterStart();
  const registrationResponse = await Passkey.create(challengeOptions);
  await api.passkeyRegisterComplete(registrationResponse);
}

// Assert an existing passkey during a verification session.
// Face embedding check must pass before this is called.
export async function assertPasskey(sessionId: string): Promise<void> {
  const Passkey = getPasskey();
  const { challengeOptions } = await api.passkeyAssertStart(sessionId);
  const assertionResponse = await Passkey.get(challengeOptions);
  await api.passkeyAssertComplete(sessionId, assertionResponse, 0);
}
