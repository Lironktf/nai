import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const POLL_INTERVAL_MS = 3000;

// Shown after Persona's flow completes, while we wait for the webhook
// to fire and advance the user's status on our server.
export default function KycPending({ onApproved, onRejected }) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    // Animate the waiting dots
    const dotTimer = setInterval(
      () => setDots((d) => (d.length >= 3 ? '' : d + '.')),
      500
    );

    // Poll /kyc/status until the user moves out of pending_kyc
    const pollTimer = setInterval(async () => {
      try {
        const { status } = await api.kycStatus();
        if (status === 'pending_video' || status === 'pending_enrollment' || status === 'active') {
          onApproved();
        } else if (status === 'rejected') {
          onRejected();
        }
        // Still 'pending_kyc' → keep polling
      } catch {
        // Network blip — keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(dotTimer);
      clearInterval(pollTimer);
    };
  }, [onApproved, onRejected]);

  return (
    <div style={styles.container}>
      <h2>Verifying your identity{dots}</h2>
      <p style={styles.sub}>
        Your documents are being reviewed. This usually takes less than a minute.
      </p>
      <div style={styles.spinner} />
      <p style={styles.hint}>You can keep this window open.</p>
    </div>
  );
}

const styles = {
  container: { maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem', textAlign: 'center' },
  sub: { color: '#555', marginBottom: '1.5rem' },
  hint: { color: '#aaa', fontSize: '0.8rem', marginTop: '1.5rem' },
  spinner: { width: 40, height: 40, border: '4px solid #eee', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' },
};
