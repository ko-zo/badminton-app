// ============================================================
// Service Worker — オフラインキャッシュ
//
// stale-while-revalidate 方式
//   1. キャッシュがあれば待たせずに返す（起動が速く、オフラインでも動く）
//   2. 同時に裏でネットワークから取り直し、成功したらキャッシュを差し替える
//   3. 差し替わった内容は次回の起動から使われる
//
// 以前の cache-first では、変更のたびに CACHE_NAME を手で書き換えないと
// 修正が永遠に利用者へ届かなかった。しかもエラーが出ないため気づけない。
// この方式にしたことで、名前の書き換えは不要になった。
// （全体を強制的に作り直したいときは、名前を変えれば従来どおり効く）
// ============================================================
const CACHE_NAME = 'badminton';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg',
];

// インストール時: ブラウザのHTTPキャッシュを迂回して最新を取り込む
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        fetch(url, { cache: 'reload' })
          .then(res => (res && res.ok) ? cache.put(url, res) : null)
          .catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

// アクティベート時: 旧方式で作られたバージョン付きキャッシュを片付ける
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // クエリ付きのURLはキャッシュに溜め込まず素通しする（同じファイルの別名保存を防ぐ）
  if (url.search) return;

  // 裏で最新を取りに行く。応答を返したあとも処理が続くよう waitUntil で保持する。
  const updating = fetch(req)
    .then(async res => {
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  event.waitUntil(updating);

  event.respondWith((async () => {
    const cache  = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;            // 起動を待たせない

    const fresh = await updating;
    if (fresh) return fresh;

    // オフラインで未キャッシュのURLを開いた場合の保険
    return (await cache.match('./index.html')) || Response.error();
  })());
});
