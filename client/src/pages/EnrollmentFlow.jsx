import { useState, useEffect, useRef } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../lib/api.js';

const MAX_RECORD_SECS = 30;
const FP_RECORD_SECS = 10;
const PROMPTS = [
  'Look directly at the camera',
  'Say your full name out loud',
  "Say today's date out loud",
  'Insert your fingerprint key into the USB-C port',
  'Keep your hand and key visible to the camera',
];

export default function EnrollmentFlow() {
  const [step, setStep] = useState('idle');
  // idle | preparing | camera | recording | preview | fp_scan | uploading | webauthn | done | error
  const [faceDetected, setFaceDetected] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [fpSecs, setFpSecs] = useState(0);
  const [promptIdx, setPromptIdx] = useState(0);
  const [error, setError] = useState('');
  const [videoObjectUrl, setVideoObjectUrl] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const profilePhotoRef = useRef(null);
  const videoBlobRef = useRef(null);
  const fpBlobRef = useRef(null);
  const fpStreamRef = useRef(null);
  const fpRecorderRef = useRef(null);
  const fpChunksRef = useRef([]);
  const timerRef = useRef(null);
  const detectionRef = useRef(null);
  const enrollDataRef = useRef({});

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearInterval(detectionRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    fpStreamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function capturePhotoFrame() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) profilePhotoRef.current = blob; }, 'image/jpeg', 0.85);
  }

  async function startCamera() {
    setStep('preparing');
    setError('');
    try {
      const { challengeOptions, nonce } = await api.enrollStart();
      enrollDataRef.current = { challengeOptions, nonce };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStep('camera');

      const [, blazeface] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/blazeface'),
      ]);
      const model = await blazeface.load();

      detectionRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const predictions = await model.estimateFaces(videoRef.current, false);
          const detected = predictions.length > 0;
          setFaceDetected(detected);
          if (detected && !profilePhotoRef.current) capturePhotoFrame();
        } catch {
          // detection blip — ignore
        }
      }, 600);
    } catch (err) {
      setError(err.message || 'Could not access camera. Check browser permissions.');
      setStep('error');
    }
  }

  function startRecording() {
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      videoBlobRef.current = blob;
      setVideoObjectUrl(URL.createObjectURL(blob));
      if (detectionRef.current) clearInterval(detectionRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setStep('preview');
    };

    recorder.start(100);
    setStep('recording');
    setRecordingSecs(0);
    setPromptIdx(0);

    let secs = 0;
    timerRef.current = setInterval(() => {
      secs++;
      setRecordingSecs(secs);
      setPromptIdx(Math.min(Math.floor(secs / 6), PROMPTS.length - 1));
      if (secs >= MAX_RECORD_SECS) stopRecording();
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state !== 'inactive') recorderRef.current.stop();
  }

  // ── Fingerprint scan recording ───────────────────────────────────────────────

  async function startFingerprintScan() {
    setStep('fp_scan');
    setFpSecs(0);
    fpChunksRef.current = [];
    fpBlobRef.current = null;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      // Camera access failed — skip fp scan, proceed to upload without it
      setStep('uploading');
      handleUpload();
      return;
    }

    fpStreamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    fpRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) fpChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      fpBlobRef.current = new Blob(fpChunksRef.current, { type: 'video/webm' });
      fpStreamRef.current?.getTracks().forEach((t) => t.stop());
      setStep('uploading');
      handleUpload();
    };

    recorder.start(100);

    let secs = 0;
    timerRef.current = setInterval(() => {
      secs++;
      setFpSecs(secs);
      if (secs >= FP_RECORD_SECS) {
        clearInterval(timerRef.current);
        if (recorder.state !== 'inactive') recorder.stop();
      }
    }, 1000);
  }

  // ── Upload + WebAuthn ────────────────────────────────────────────────────────

  async function handleUpload() {
    setError('');
    try {
      const formData = new FormData();
      formData.append('video', videoBlobRef.current, `enrollment_${enrollDataRef.current.nonce}.webm`);
      if (profilePhotoRef.current) {
        formData.append('photo', profilePhotoRef.current, 'profile.jpg');
      }
      if (fpBlobRef.current) {
        formData.append('fp_scan', fpBlobRef.current, `fp_${enrollDataRef.current.nonce}.webm`);
      }
      formData.append('nonce', enrollDataRef.current.nonce);

      const { enrollmentVideoId } = await api.enrollVideoUpload(formData);
      enrollDataRef.current.enrollmentVideoId = enrollmentVideoId;

      setStep('webauthn');
      const registrationResponse = await startRegistration(enrollDataRef.current.challengeOptions);
      await api.enrollWebauthnComplete(registrationResponse, enrollmentVideoId);
      setStep('done');
    } catch (err) {
      console.error('Enrollment submit error:', err);
      setError(err.message || 'Enrollment failed. Please try again.');
      setStep('error');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <div style={{ ...s.container, textAlign: 'center' }}>
        <div style={s.badge}>Enrollment Submitted</div>
        <h2>Awaiting admin review</h2>
        <p style={{ color: '#555' }}>
          Your enrollment video, fingerprint scan, and key have been submitted.
          You'll be notified when an admin approves your enrollment.
        </p>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div style={s.container}>
        <p style={s.errorText}>{error}</p>
        <button style={s.btn} onClick={() => { setStep('idle'); setError(''); }}>
          Try again
        </button>
      </div>
    );
  }

  if (step === 'idle') {
    return (
      <div style={s.container}>
        <h2>Register Your Fingerprint Key</h2>
        <p style={{ color: '#555', marginBottom: '1.5rem' }}>
          You'll record a short video showing your face, then a 10-second clip of you
          physically scanning your fingerprint key. Then you'll tap it to register it cryptographically.
        </p>
        <ul style={s.checklist}>
          <li>Have your USB-C fingerprint key ready</li>
          <li>Ensure good lighting on your face</li>
          <li>Allow camera and microphone access</li>
          <li>The face recording is up to {MAX_RECORD_SECS} seconds</li>
        </ul>
        <button style={s.btn} onClick={startCamera}>Begin Enrollment</button>
      </div>
    );
  }

  if (step === 'preparing') {
    return <Centered message="Preparing camera..." />;
  }

  if (step === 'camera' || step === 'recording') {
    return (
      <div style={s.cameraContainer}>
        <div style={s.videoWrapper}>
          <video ref={videoRef} style={s.video} muted playsInline />
          <div style={{ ...s.overlay, top: 12, left: 12 }}>
            <span style={{ color: faceDetected ? '#4ade80' : '#f87171', fontWeight: 600 }}>
              {faceDetected ? '✓ Face detected' : '⚠ Position your face in frame'}
            </span>
          </div>
          {step === 'recording' && (
            <div style={{ ...s.overlay, bottom: 60, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
              <div style={s.prompt}>{PROMPTS[promptIdx]}</div>
            </div>
          )}
          {step === 'recording' && (
            <div style={{ ...s.overlay, top: 12, right: 12 }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>
                ● {recordingSecs}s / {MAX_RECORD_SECS}s
              </span>
            </div>
          )}
        </div>
        <div style={s.controls}>
          {step === 'camera' && (
            <button style={s.btn} onClick={startRecording} disabled={!faceDetected}>
              {faceDetected ? 'Start Recording' : 'Waiting for face...'}
            </button>
          )}
          {step === 'recording' && (
            <button style={{ ...s.btn, background: '#c00' }} onClick={stopRecording}>
              Stop Recording
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === 'preview') {
    return (
      <div style={s.container}>
        <h2>Review Your Recording</h2>
        <p style={{ color: '#555' }}>
          Watch the video below. If it looks good, continue to the fingerprint scan step.
        </p>
        <video src={videoObjectUrl} controls style={{ width: '100%', borderRadius: 8, marginBottom: '1rem' }} />
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button style={{ ...s.btn, background: '#555', flex: 1 }}
            onClick={() => { setStep('idle'); setVideoObjectUrl(null); }}>
            Re-record
          </button>
          <button style={{ ...s.btn, flex: 1 }} onClick={startFingerprintScan}>
            Continue →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'fp_scan') {
    return (
      <div style={s.cameraContainer}>
        <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Fingerprint Scan Recording</h2>
        <p style={{ textAlign: 'center', color: '#555', marginBottom: '1rem' }}>
          Place your finger on your key now. Recording automatically stops after {FP_RECORD_SECS} seconds.
        </p>
        <div style={s.videoWrapper}>
          <video ref={videoRef} style={s.video} muted playsInline />
          <div style={{ ...s.overlay, top: 12, right: 12 }}>
            <span style={{ color: '#f87171', fontWeight: 700 }}>
              ● {fpSecs}s / {FP_RECORD_SECS}s
            </span>
          </div>
          <div style={{ ...s.overlay, bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
            <span style={{ fontWeight: 600 }}>Hold your key up so your finger on it is visible</span>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'uploading') {
    return <Centered message="Uploading your enrollment videos..." />;
  }

  if (step === 'webauthn') {
    return (
      <div style={{ ...s.container, textAlign: 'center' }}>
        <h2>Register Your Key</h2>
        <p style={{ color: '#555' }}>
          Insert your USB-C fingerprint key and touch it when prompted by the browser.
        </p>
        <div style={s.spinner} />
        <p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '1rem' }}>
          Waiting for key interaction...
        </p>
      </div>
    );
  }

  return null;
}

function Centered({ message }) {
  return (
    <div style={{ ...s.container, textAlign: 'center' }}>
      <p style={{ color: '#555' }}>{message}</p>
      <div style={s.spinner} />
    </div>
  );
}

const s = {
  container: { maxWidth: 480, margin: '60px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' },
  cameraContainer: { maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' },
  videoWrapper: { position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden' },
  video: { width: '100%', display: 'block', transform: 'scaleX(-1)' },
  overlay: { position: 'absolute', background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: '0.85rem' },
  prompt: { background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '10px 20px', borderRadius: 20, fontSize: '1rem', fontWeight: 600 },
  controls: { display: 'flex', justifyContent: 'center', marginTop: '1rem', gap: '0.75rem' },
  btn: { padding: '0.75rem 1.5rem', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: '1rem', cursor: 'pointer' },
  badge: { display: 'inline-block', background: '#d4edda', color: '#155724', borderRadius: 20, padding: '0.4rem 1rem', fontWeight: 600, marginBottom: '1rem' },
  checklist: { color: '#444', lineHeight: 1.8, paddingLeft: '1.25rem', marginBottom: '1.5rem' },
  errorText: { color: '#c00', marginBottom: '1rem' },
  spinner: { width: 36, height: 36, border: '3px solid #eee', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '1.5rem auto' },
};
