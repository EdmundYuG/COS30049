/* eslint-env serviceworker */
/**
 * Minimal service worker.
 *
 * Two jobs:
 *   1. make the app installable, so a visitor can keep it on their home screen
 *   2. keep the shell and any plant page they have already opened available
 *      when the signal drops, which happens constantly under forest canopy
 *
 * Deliberately conservative: API writes never touch the cache, and a stale
 * plant record is always labelled as such by the page that reads it.
 */

const VERSION = 'florascan-v3'; // bump when cached shell files change (v3: apple touch icon set)
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .catch(() => {}) // a missing file must not block installation
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const isPhoto = (url) => url.pathname.startsWith('/api/photos/') || url.pathname.startsWith('/photos/');
const isReadApi = (url, req) => url.pathname.startsWith('/api/') && req.method === 'GET';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the dev server's own plumbing.
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules')
      || url.searchParams.has('t') || url.pathname === '/sw.js') {
    return;
  }
  // The certificate download is a navigation too; left to the handler below
  // it would be cached as the app shell.
  if (url.pathname === '/florascan-ca.crt') return;

  // Navigation: network first so the app updates, cache as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(request))),
    );
    return;
  }

  // Photographs barely change: serve from cache, fill in behind.
  if (isPhoto(url)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })),
    );
    return;
  }

  // API reads: network first, fall back to the last good answer offline.
  if (isReadApi(url, request)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || Response.json(
          { error: 'You are offline and this has not been loaded before.', offline: true },
          { status: 503 },
        ))),
    );
    return;
  }

  // Everything else (built JS/CSS/icons): cache first.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(RUNTIME).then((c) => c.put(request, copy)).catch(() => {});
      }
      return res;
    })),
  );
});
