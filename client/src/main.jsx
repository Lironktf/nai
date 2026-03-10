import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LivenessPage from './pages/LivenessPage.jsx';
import TelegramAuth from './pages/TelegramAuth.jsx';

const root = createRoot(document.getElementById('root'));

if (window.location.pathname === '/liveness') {
  root.render(<StrictMode><LivenessPage /></StrictMode>);
} else if (window.location.pathname === '/auth/telegram') {
  root.render(<StrictMode><TelegramAuth /></StrictMode>);
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
