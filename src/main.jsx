import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Opening animation: stays ~1.5s, and until the app has loaded (max 4s), then fades into the page.
const SPLASH_MIN = 1500;
const SPLASH_MAX = 4000;
let ready = false;
let minDone = false;
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('out')) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 600);
}
setTimeout(() => { minDone = true; if (ready) hideSplash(); }, Math.max(0, SPLASH_MIN - performance.now()));
setTimeout(hideSplash, SPLASH_MAX);
window.__forsaReady = () => { ready = true; if (minDone) hideSplash(); };

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
