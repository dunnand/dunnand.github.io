// Minimal service worker — just enough for Android's "installable PWA"
// criteria. Deliberately does NOT cache the audio stream or the now-playing
// JSON: those must always come from the network. Only the static app shell
// is cached, so the icon/name still resolve if the app is opened offline
// right after install; everything else is network-first / network-only.
const SHELL_CACHE = 'wcyt-radio-shell-v2'; // bumped to flush the old buggy-matched cache
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Exact pathnames, resolved once against this SW's own scope — the previous
// endsWith() check had a bug: './'.replace('./','') is '', and every string
// endsWith(''), so it was accidentally treating ALL same-origin requests
// (including the raw now-playing... no, that's cross-origin, but e.g.
// /images/art_overrides.json) as shell files needing this caching layer.
const SHELL_PATHS = new Set(SHELL_FILES.map((f) => new URL(f, self.registration.scope).pathname));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = url.origin === self.location.origin && SHELL_PATHS.has(url.pathname);
  if (!isShellFile) return; // let the browser handle everything else normally

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
