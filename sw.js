// sw.js — caches the app shell so identity/wallet state already on this
// device still opens with no network. Real Solana calls (balance, burn)
// and any P2P sync with another peer obviously still need a genuine
// connection, but reading and accruing against state you already hold
// locally doesn't.
//
// UNLIKE AIWA_chain's own sw.js, this deliberately does NOT precache an
// exhaustive, hand-enumerated file list: aiwa-core/aiwa-lib/aiwa-platform
// live in node_modules/ as real git dependencies whose exact file set
// can change between installs, and a precache `cache.addAll()` fails its
// entire install the moment any one listed file 404s. Instead, only the
// small, guaranteed-stable shell is precached; everything else
// same-origin (every node_modules/ file this page actually imports) is
// cached opportunistically as it's fetched — after one normal online
// visit, the exact set of files this page needs is already cached, and
// later offline visits are served from it.

const CACHE_NAME = 'aiwa-project-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only manage same-origin requests; let CDN modules (esm.sh's
  // @solana/web3.js and qrcode) and real Solana RPC traffic pass
  // straight through.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // Network-first, cache as fallback — not cache-first, so an online
  // reload always fetches the live deploy (a real dependency update
  // shows up immediately), and only falls back to whatever's cached
  // when the network request actually fails (genuinely offline).
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
