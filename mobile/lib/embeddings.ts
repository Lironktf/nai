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
  const photo = await cameraRef.takePictureAsync({ base64: true, quality: 0.7 });
  if (!photo.base64) throw new Error('Camera did not return a base64 image');
  return api.checkFaceEmbedding(sessionId, photo.base64);
}

// Direct server call — use when you already have a base64 JPEG frame.
export async function checkFaceEmbedding(
  sessionId: string,
  imageBase64: string
): Promise<{ passed: boolean; score: number }> {
  return api.checkFaceEmbedding(sessionId, imageBase64);
}
