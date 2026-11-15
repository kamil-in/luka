// Service worker for the static (GitHub Pages) build; tools/build-pages.mjs copies it to the site's
// root and the page registers it (the `luka-sw` meta tag).
//
// Pages fixes its cache lifetime at 10 minutes, so without this every firmware's wasm is asked for
// again on each visit after that. Here:
//  - a firmware's wasm (native/*.wasm?v=<hash>) is kept for good: the hash is in its address, so
//    the bytes under it never change; when a build's hash changes, the older copies of it go.
//  - everything else (the page, its scripts, the list) is network first, the kept copy if offline.

const BUILDS = "luka-builds";
const SHELL = "luka-shell";

addEventListener("install", () => skipWaiting());
addEventListener("activate", (event) => event.waitUntil(clients.claim()));

addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(url.pathname.includes("/native/") && url.pathname.endsWith(".wasm") && url.searchParams.has("v") ? build(request, url) : shell(request));
});

async function build(request, url) {
  const cache = await caches.open(BUILDS);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) {
    try {
      await cache.put(request, response.clone());
      for (const old of await cache.keys()) {
        const o = new URL(old.url);
        if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
      }
    } catch { /* storage is full or refused: played from the network, then */ }
  }
  return response;
}

async function shell(request) {
  try {
    const response = await fetch(request);
    if (response.ok) caches.open(SHELL).then((cache) => cache.put(request, response.clone())).catch(() => {});
    return response;
  } catch (e) {
    const kept = await caches.match(request, { ignoreSearch: true });
    if (kept) return kept;
    throw e;
  }
}
