const CACHE_NAME = "studybot-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/static/js/bundle.js",   // adjust to your build output
  "/static/css/main.css",
  // Add other static assets (icons, fonts) as needed
];

// Install – cache core assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate – clean old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Fetch – cache first, then network — but ONLY for same-origin GET requests.
//
// Previously this handler intercepted every GET request regardless of
// origin, which meant GET calls to *.supabase.co (e.g. the `profiles`
// select query, or any REST GET) could be served from — and written into —
// this cache. On a shared device where different users sign in over time,
// that risks serving one user's cached API response to a different user
// after they log in. Scoping to same-origin avoids that entirely; the
// browser/network handles all cross-origin and API traffic natively.
self.addEventListener("fetch", event => {
  // Only handle GET requests.
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests — never intercept calls to Supabase,
  // Google, or any other third-party API.
  if (url.origin !== self.location.origin) return;

  // Belt-and-suspenders: still skip anything under /api/ even same-origin,
  // in case a future same-origin API proxy is added.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(response => {
        // Only cache successful, basic (same-origin) responses.
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      });
    })
  );
});