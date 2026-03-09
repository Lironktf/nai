import { useEffect, useState } from 'react';
import Register from './pages/Register.jsx';
import Login from './pages/Login.jsx';
import KycFlow from './pages/KycFlow.jsx';
import KycPending from './pages/KycPending.jsx';
import EnrollmentFlow from './pages/EnrollmentFlow.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import { api } from './lib/api.js';

// Decode JWT payload without verification (display-only)
function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

// Screens in the user lifecycle:
//   register → login → kyc → kyc_pending → enroll → done
//   admin users land directly on the admin panel
//   On refresh with a token: resume at the correct screen based on server status.

const STATUS_TO_SCREEN = {
  pending_kyc: 'kyc',
  pending_video: 'enroll',
  pending_enrollment: 'enroll',
  pending_admin: 'enroll',
  active: 'enroll',
  rejected: 'rejected',
};

export default function App() {
  const [screen, setScreen] = useState('boot'); // boot | register | login | kyc | kyc_pending | enroll | admin | rejected

  useEffect(() => {
    const token = localStorage.getItem('th_token');
    if (!token) {
      setScreen('register');
      return;
    }

    const payload = decodeJwt(token);
    if (payload?.isAdmin) {
      setScreen('admin');
      return;
    }

    api.kycStatus()
      .then(({ status }) => setScreen(STATUS_TO_SCREEN[status] ?? 'register'))
      .catch(() => {
        localStorage.removeItem('th_token');
        setScreen('register');
      });
  }, []);

  function handleAuthSuccess(token) {
    localStorage.setItem('th_token', token);
    const payload = decodeJwt(token);
    if (payload?.isAdmin) {
      setScreen('admin');
    } else {
      setScreen('kyc');
    }
  }

  if (screen === 'boot') return <Loading />;

  if (screen === 'register') {
    return (
      <Register
        onRegistered={(token) => handleAuthSuccess(token)}
        onLoginClick={() => setScreen('login')}
      />
    );
  }

  if (screen === 'login') {
    return (
      <Login
        onLoggedIn={(token) => handleAuthSuccess(token)}
        onRegisterClick={() => setScreen('register')}
      />
    );
  }

  if (screen === 'kyc') {
    return (
      <KycFlow
        onComplete={() => setScreen('kyc_pending')}
        onError={() => setScreen('kyc_pending')}
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
    return <EnrollmentFlow />;
  }

  if (screen === 'admin') {
    return <AdminPanel />;
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
