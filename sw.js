// 离线缓存。联网时优先取最新文件（方便更新），3 秒内取不到或断网时用缓存。
const CACHE = 'holo-v7';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/main.js',
  'js/quadview.js',
  'js/store.js',
  'js/ui.js',
  'js/importers.js',
  'js/cutout.js',
  'js/cutout-worker.js',
  'js/scenes/util.js',
  'js/scenes/jellyfish.js',
  'js/scenes/fireworks.js',
  'js/scenes/spiral.js',
  'js/scenes/galaxy.js',
  'js/scenes/globe.js',
  'js/scenes/textring.js',
  'js/scenes/calib.js',
  'vendor/three/three.module.min.js',
  'vendor/three/environments/RoomEnvironment.js',
  'vendor/three/loaders/GLTFLoader.js',
  'vendor/three/loaders/DRACOLoader.js',
  'vendor/three/utils/BufferGeometryUtils.js',
  'vendor/three/libs/draco/gltf/draco_decoder.js',
  'vendor/three/libs/draco/gltf/draco_decoder.wasm',
  'vendor/three/libs/draco/gltf/draco_wasm_wrapper.js',
];
// 体积大的可选内容：抠图的运行库和模型、内置的 3D 模型。存储空间不够时它们可能存不进去，
// 不能因此让整个离线功能装不上，所以单独尽力缓存；没存上的，联网时照常能用，用过一次也会被缓存。
const EXTRAS = [
  'vendor/onnxruntime-web/ort.wasm.min.js',
  'vendor/onnxruntime-web/ort-wasm-simd.wasm',
  'vendor/u2netp/u2netp.onnx',
  'glbs/fantasy_butterfly_animation.glb',
  'glbs/bangboo_01_-_eous.glb',
  'glbs/low_poly_dolphin.glb',
  'glbs/test_middle_finger.glb',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    await Promise.allSettled(EXTRAS.map((url) => c.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (res.ok) cache.put(req, res.clone()).catch(() => {}); // 空间不够存不进去也不影响这次返回
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
