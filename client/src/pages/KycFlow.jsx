import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Persona SDK is loaded from their CDN at runtime.
// Pin this version in production. Check https://docs.withpersona.com for latest.
const PERSONA_SDK_URL = 'https://cdn.withpersona.com/dist/persona-v4.8.0.js';

export default function KycFlow({ onComplete, onError }) {
  const [status, setStatus] = useState('loading'); // loading | ready | launched | error
  const [errorMsg, setErrorMsg] = useState('');
  const launched = useRef(false);
  const started = useRef(false); // prevents StrictMode double-invoke

  useEffect(() => {
    let client;

    async function init() {
      if (started.current) return;
      started.current = true;
      try {
        // 1. Get inquiry credentials from the server
        console.log('[KYC] Calling /kyc/start...');
        const creds = await api.kycStart();
        const { inquiryId, sessionToken } = creds;
        console.log('[KYC] Got inquiryId:', inquiryId);

        // 2. Load Persona SDK script
        console.log('[KYC] Loading Persona SDK from CDN...');
        await loadScript(PERSONA_SDK_URL);
        console.log('[KYC] Persona SDK loaded. window.Persona:', !!window.Persona);

        if (launched.current) return;
        launched.current = true;

        // 3. Launch the Persona embedded flow
        client = new window.Persona.Client({
          inquiryId,
          sessionToken,
          onLoad: () => {
            console.log('[KYC] Persona onLoad fired');
            setStatus('launched');
          },
          onComplete: ({ inquiryId: id, status: s }) => {
            console.log('[KYC] Persona onComplete:', id, s);
            onComplete({ inquiryId: id, personaStatus: s });
          },
          onCancel: () => {
            console.log('[KYC] Persona onCancel');
            setStatus('ready');
            launched.current = false;
          },
          onError: (err) => {
            console.error('[KYC] Persona SDK error:', err);
            setErrorMsg('Verification encountered an error. Please try again.');
            setStatus('error');
            onError(err);
          },
        });
        console.log('[KYC] Calling client.open()...');
        client.open();
        setStatus('launched');
      } catch (err) {
        console.error('[KYC] init() failed:', err);
        setErrorMsg(err.message || 'Could not start identity verification.');
        setStatus('error');
        onError(err);
      }
    }

    init();

    return () => {
      // Persona client doesn't expose a destroy method — nothing to clean up
    };
  }, []);

  if (status === 'loading') {
    return <Screen message="Preparing identity verification..." />;
  }

  if (status === 'error') {
    return (
      <div style={styles.container}>
        <p style={styles.error}>{errorMsg}</p>
        <button
          style={styles.button}
          onClick={() => {
            launched.current = false;
            setStatus('loading');
            setErrorMsg('');
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // When launched, Persona opens its own overlay. Show a minimal backdrop.
  return <Screen message="Complete the verification steps in the popup..." />;
}

function Screen({ message }) {
  return (
    <div style={styles.container}>
      <h2 style={{ marginBottom: '1rem' }}>Identity Verification</h2>
      <p style={{ color: '#555' }}>{message}</p>
      <div style={styles.spinner} />
    </div>
  );
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    function waitForPersona(attempts = 0) {
      if (window.Persona) return resolve();
      if (attempts > 50) return reject(new Error('Persona SDK loaded but window.Persona not initialized'));
      setTimeout(() => waitForPersona(attempts + 1), 100);
    }

    // If already loaded just wait for window.Persona to be ready
    if (document.querySelector(`script[src="${src}"]`)) {
      waitForPersona();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.onload = () => waitForPersona();
    script.onerror = () => reject(new Error(`Failed to load Persona SDK from CDN`));
    document.head.appendChild(script);
  });
}

const styles = {
  container: { maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem', textAlign: 'center' },
  error: { color: '#c00', marginBottom: '1rem' },
  button: { padding: '0.75rem 1.5rem', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: '1rem', cursor: 'pointer' },
  spinner: { width: 32, height: 32, border: '3px solid #eee', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '1.5rem auto' },
};
