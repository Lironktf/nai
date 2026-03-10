import * as ImageManipulator from 'expo-image-manipulator';
import { api } from './api';

// Capture a selfie from a mounted expo-camera CameraView ref and compare it
// against the user's stored profile photo via the server's Azure Face API.
// Returns { passed, score }.
//
// Usage: call this with the ref returned by useRef<CameraView>() in the
// verify screen after mounting the camera.
export async function captureAndCheckFace(
  cameraRef: { takePictureAsync: (opts?: object) => Promise<{ base64?: string }> },
  sessionId: string
): Promise<{ passed: boolean; score: number }> {
  const captureTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Camera capture timed out after 10s')), 10_000)
  );
  // Capture at native resolution first (base64 not needed yet).
  const raw = await Promise.race([
    cameraRef.takePictureAsync({ base64: false, quality: 1 }),
    captureTimeout,
  ]);
  if (!raw.uri) throw new Error('Camera did not return a photo URI');

  // Resize to 640px wide and compress to keep payload under ~80KB for ngrok.
  const resized = await ImageManipulator.manipulateAsync(
    raw.uri,
    [{ resize: { width: 640 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  if (!resized.base64) throw new Error('Image resize did not return base64');

  return api.checkFaceEmbedding(sessionId, resized.base64);
}

// Direct server call — use when you already have a base64 JPEG frame.
export async function checkFaceEmbedding(
  sessionId: string,
  imageBase64: string
): Promise<{ passed: boolean; score: number }> {
  return api.checkFaceEmbedding(sessionId, imageBase64);
}
