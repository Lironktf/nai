import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LivenessPage from './pages/LivenessPage.jsx';

const root = createRoot(document.getElementById('root'));

if (window.location.pathname === '/liveness') {
  root.render(<StrictMode><LivenessPage /></StrictMode>);
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
