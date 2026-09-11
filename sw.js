const CACHE = "beenthere-v0.4.4-shell";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener("fetch",event=>{
  event.respondWith(caches.match(event.request).then(cached=>cached || fetch(event.request)));
});
