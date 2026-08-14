// Minimal service worker — just enough for Android's "installable PWA"
// criteria. Deliberately does NOT cache the audio stream or the now-playing
// JSON: those must always come from the network. Only the static app shell
// is cached, so the icon/name still resolve if the app is opened offline
// right after install; everything else is network-first / network-only.
const SHELL_CACHE = 'wcyt-radio-shell-v1';
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = url.origin === self.location.origin &&
    SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '')));
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
