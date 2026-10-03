/**
 * "Add to Home Screen" support.
 *
 * The three platforms disagree completely about how this works:
 *
 *   Android / Chrome  fires `beforeinstallprompt`, which we stash and replay
 *                     when the visitor taps our own button. Needs HTTPS and a
 *                     registered service worker, so over plain http on the LAN
 *                     it never fires and we fall back to instructions.
 *   iOS / Safari      no API at all. The visitor must use Share -> Add to Home
 *                     Screen, so all we can do is say so clearly.
 *   Desktop           usually offers an install icon in the address bar.
 *
 * So: use the real prompt when the browser gives us one, and otherwise show
 * the right instructions for the browser actually in use.
 */

const DISMISS_KEY = 'florascan.install-dismissed';

let deferredPrompt = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem(DISMISS_KEY, 'installed'); } catch { /* private mode */ }
    notify();
  });
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const hasNativePrompt = () => !!deferredPrompt;

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const e = deferredPrompt;
  deferredPrompt = null;
  notify();
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome; // 'accepted' | 'dismissed'
}

/** Already launched from the home screen? Then there is nothing to offer. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ reports itself as a Mac, so check for touch as well.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (ios) {
    // On iOS every browser is Safari underneath, but only Safari itself can
    // add to the home screen.
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/**
 * What to tell this visitor. Returns null when there is nothing useful to say.
 */
export function installAdvice() {
  if (isStandalone()) return null;
  const p = platform();

  if (deferredPrompt) {
    return {
      kind: 'prompt',
      title: 'Add FloraScan to your home screen',
      body: 'It opens full screen, without the browser bars, and remembers the pages you have already visited.',
      action: 'Add to home screen',
    };
  }

  if (p === 'ios-safari') {
    return {
      kind: 'ios',
      title: 'Add FloraScan to your home screen',
      body: 'Tap the Share button at the bottom of Safari, then choose "Add to Home Screen".',
      steps: ['Tap Share', 'Scroll to "Add to Home Screen"', 'Tap Add'],
    };
  }

  if (p === 'ios-other') {
    return {
      kind: 'ios-other',
      title: 'Open this in Safari to install it',
      body: 'Only Safari can add a site to the iPhone home screen. Open the same address in Safari, then use Share → Add to Home Screen.',
    };
  }

  if (p === 'android') {
    // Chrome offers a one-tap install, but only once it has a manifest, a
    // service worker and a genuinely secure origin. On a plain http:// LAN
    // address none of that applies, so say why rather than promise a button
    // that will not appear.
    const overHttps = window.location.protocol === 'https:';
    return {
      kind: 'android',
      title: 'Add FloraScan to your home screen',
      body: overHttps
        ? 'Chrome has not offered its install button yet. Open the browser menu and choose "Install app" or "Add to Home screen".'
        : 'Open the browser menu and choose "Add to Home screen". Android’s one-tap install button only appears over HTTPS — start the server with "npm run https" to get it.',
      one_tap_blocked_by_http: !overHttps,
    };
  }

  return {
    kind: 'desktop',
    title: 'Install FloraScan',
    body: 'Most desktop browsers show an install icon at the right-hand end of the address bar.',
  };
}

export const isDismissed = () => {
  try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; }
};

export const dismiss = () => {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
  notify();
};

export const undismiss = () => {
  try { localStorage.removeItem(DISMISS_KEY); } catch { /* private mode */ }
  notify();
};

/** Registered only on a secure origin; the browser refuses otherwise. */
/**
 * Chrome will not offer its one-tap install until a service worker with a
 * fetch handler is registered, so skipping it in dev would mean the Android
 * install button never appears — including under `npm run https`, which is
 * exactly the phone demo.
 *
 * So: register whenever the origin is really HTTPS, and skip only on
 * http://localhost, where a cache would fight Vite's hot reload. (localhost
 * counts as a secure context, which is why the protocol is checked and not
 * just `isSecureContext`.)
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  const realHttps = window.location.protocol === 'https:';
  if (import.meta.env?.DEV && !realHttps) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Nothing to do: the app works fine without it, just not offline.
    });
  });
}
