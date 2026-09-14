import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ensureStorageSchema } from '@core/utils/storage';

// Wipe legacy persisted blobs from previous schema versions on the very first
// load after a deploy. Runs synchronously before React mounts so no component
// can ever read stale state from a bumped schema version.
ensureStorageSchema();

// Lock mobile screen orientation to portrait if supported
const tryLockPortrait = () => {
    try {
        if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
            window.screen.orientation.lock('portrait').catch(() => {});
        }
    } catch (e) {
        // Unsupported or fullscreen needed - gracefully ignored
    }
};
tryLockPortrait();
if (typeof window !== 'undefined') {
    window.addEventListener('touchstart', tryLockPortrait, { once: true, passive: true });
    window.addEventListener('click', tryLockPortrait, { once: true, passive: true });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => {});
        });
    }
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
