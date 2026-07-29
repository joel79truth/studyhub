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

// Fetch – cache first, then network
self.addEventListener("fetch", event => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  // For API calls, we don't cache (they go through the offline queue)
  if (event.request.url.includes("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(response => {
        // Cache dynamic responses for next time
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      });
    })
  );
});