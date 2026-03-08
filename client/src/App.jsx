import { useEffect, useState } from 'react';
import Register from './pages/Register.jsx';
import KycFlow from './pages/KycFlow.jsx';
import KycPending from './pages/KycPending.jsx';
import EnrollPlaceholder from './pages/EnrollPlaceholder.jsx';
import { api } from './lib/api.js';

// Screens in the user lifecycle:
//   register → kyc → kyc_pending → enroll (Chunk 3+)
//   On refresh with a token: resume at the correct screen based on server status.

const STATUS_TO_SCREEN = {
  pending_kyc: 'kyc',              // still needs to complete Persona flow
  pending_video: 'enroll',
  pending_enrollment: 'enroll',
  pending_admin: 'enroll',
  active: 'enroll',
  rejected: 'rejected',
};

export default function App() {
  const [screen, setScreen] = useState('boot'); // boot | register | kyc | kyc_pending | enroll | rejected

  // On mount: check for an existing token and resume at the right screen
  useEffect(() => {
    const token = localStorage.getItem('th_token');
    if (!token) {
      setScreen('register');
      return;
    }
    api.kycStatus()
      .then(({ status }) => setScreen(STATUS_TO_SCREEN[status] ?? 'register'))
      .catch(() => {
        // Token likely expired
        localStorage.removeItem('th_token');
        setScreen('register');
      });
  }, []);

  if (screen === 'boot') {
    return <Loading />;
  }

  if (screen === 'register') {
    return (
      <Register
        onRegistered={() => setScreen('kyc')}
      />
    );
  }

  if (screen === 'kyc') {
    return (
      <KycFlow
        onComplete={() => setScreen('kyc_pending')}
        onError={() => setScreen('kyc_pending')} // Still poll — Persona may have captured docs
      />
    );
  }

  if (screen === 'kyc_pending') {
    return (
      <KycPending
        onApproved={() => setScreen('enroll')}
        onRejected={() => setScreen('rejected')}
      />
    );
  }

  if (screen === 'enroll') {
    return <EnrollPlaceholder />;
  }

  if (screen === 'rejected') {
    return (
      <div style={styles.center}>
        <h2>Verification Failed</h2>
        <p style={{ color: '#555' }}>
          Your identity could not be verified. Contact support if you believe this is an error.
        </p>
      </div>
    );
  }

  return null;
}

function Loading() {
  return (
    <div style={styles.center}>
      <div style={styles.spinner} />
    </div>
  );
}

const styles = {
  center: { maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem', textAlign: 'center' },
  spinner: { width: 32, height: 32, border: '3px solid #eee', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' },
};
