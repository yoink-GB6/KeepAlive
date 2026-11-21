// 抠图的计算都在这个 Worker 里，不卡住画面。
// 推理库（约 10 MB）和模型（约 5 MB）等第一张照片送到才载入。
const ORT_DIR = new URL('../vendor/onnxruntime-web/', self.location.href).href;
const MODEL_URL = new URL('../vendor/u2netp/u2netp.onnx', self.location.href).href;
const SIZE = 320; // 模型固定的输入边长，照片不管什么比例都压成这个方形
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// 蒙版值到不透明度的过渡区间。下限取得偏高，把主体外面那一圈背景色的亮边收掉；
// 中间平滑过渡，边缘是柔的而不是一刀剪齐
const EDGE_LO = 0.4;
const EDGE_HI = 0.9;
const MARGIN = 0.04; // 裁剪时在主体四周留的边，占主体长边的比例
const NO_SUBJECT = '没有找到主体';

// 载入推理库和模型，只做一次。失败了不在这里重试：主线程会换一个新的 Worker
let sessionPromise = null;
function session() {
  sessionPromise ??= (async () => {
    importScripts(`${ORT_DIR}ort.wasm.min.js`);
    ort.env.wasm.wasmPaths = ORT_DIR;
    ort.env.wasm.numThreads = 1; // 多线程需要跨源隔离，GitHub Pages 给不了
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
  })();
  return sessionPromise;
}

// 按面积平均缩到 SIZE×SIZE，并做成模型要的格式（按通道排列、减均值除方差）
function toInput(rgba, w, h) {
  const n = SIZE * SIZE;
  const sum = new Float32Array(n * 3);
  const count = new Uint32Array(n);
  const col = new Uint32Array(w);
  for (let x = 0; x < w; x++) col[x] = Math.min(SIZE - 1, Math.floor((x * SIZE) / w));
  for (let y = 0, i = 0; y < h; y++) {
    const row = Math.min(SIZE - 1, Math.floor((y * SIZE) / h)) * SIZE;
    for (let x = 0; x < w; x++, i += 4) {
      const j = row + col[x];
      sum[j * 3] += rgba[i];
      sum[j * 3 + 1] += rgba[i + 1];
      sum[j * 3 + 2] += rgba[i + 2];
      count[j]++;
    }
  }
  const input = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const k = 1 / (255 * Math.max(1, count[j])); // 照片比 320 还小时有的格子是空的
    for (let c = 0; c < 3; c++) input[c * n + j] = (sum[j * 3 + c] * k - MEAN[c]) / STD[c];
  }
  return input;
}

// 返回 SIZE×SIZE 的蒙版，1 是主体、0 是背景
async function predict(rgba, w, h) {
  const s = await session();
  const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', toInput(rgba, w, h), [1, 3, SIZE, SIZE]) };
  const raw = (await s.run(feeds))[s.outputNames[0]].data;
  const n = SIZE * SIZE;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (raw[i] < lo) lo = raw[i];
    if (raw[i] > hi) hi = raw[i];
  }
  // 整张图都没有把握：下面的拉伸会把噪声放大成一块块的"主体"，不如直接放弃
  if (hi < 0.5) throw new Error(NO_SUBJECT);
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) mask[i] = (raw[i] - lo) / (hi - lo);
  return mask;
}

// 主体的包围框（照片像素坐标），四周留一点边
function subjectBox(mask, w, h) {
  let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1, count = 0;
  for (let y = 0, i = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, i++) {
      if (mask[i] <= 0.5) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (count < SIZE * SIZE * 0.003) throw new Error(NO_SUBJECT);
  const sx = w / SIZE, sy = h / SIZE;
  const pad = MARGIN * Math.max((x1 - x0 + 1) * sx, (y1 - y0 + 1) * sy);
  const left = Math.max(0, Math.floor(x0 * sx - pad));
  const top = Math.max(0, Math.floor(y0 * sy - pad));
  return {
    left,
    top,
    width: Math.min(w, Math.ceil((x1 + 1) * sx + pad)) - left,
    height: Math.min(h, Math.ceil((y1 + 1) * sy + pad)) - top,
  };
}

// 把蒙版放大回照片的分辨率（双线性插值），主体乘上不透明度画在纯黑底上，只输出包围框以内的部分
function composite(rgba, w, h, mask, box) {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  const last = SIZE - 1;
  for (let y = 0, o = 0; y < box.height; y++) {
    const fy = Math.max(0, Math.min(last, ((y + box.top + 0.5) * SIZE) / h - 0.5));
    const ya = Math.floor(fy), yb = Math.min(last, ya + 1), ty = fy - ya;
    for (let x = 0; x < box.width; x++, o += 4) {
      const fx = Math.max(0, Math.min(last, ((x + box.left + 0.5) * SIZE) / w - 0.5));
      const xa = Math.floor(fx), xb = Math.min(last, xa + 1), tx = fx - xa;
      const m = (mask[ya * SIZE + xa] * (1 - tx) + mask[ya * SIZE + xb] * tx) * (1 - ty)
        + (mask[yb * SIZE + xa] * (1 - tx) + mask[yb * SIZE + xb] * tx) * ty;
      let a = (m - EDGE_LO) / (EDGE_HI - EDGE_LO);
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      const i = ((y + box.top) * w + x + box.left) * 4;
      out[o] = rgba[i] * a;
      out[o + 1] = rgba[i + 1] * a;
      out[o + 2] = rgba[i + 2] * a;
      out[o + 3] = 255;
    }
  }
  return out;
}

// 收到 { id, width, height, buffer }（RGBA 像素），回 { id, width, height, buffer }（裁好的黑底图）或 { id, error }。
// 中途用 { id, stage } 报告进度：'load' 正在载入模型，'run' 开始计算
self.onmessage = async (e) => {
  const { id, width, height, buffer } = e.data;
  // 出错时报给用户的说法按阶段来，库里抛出来的英文原话用户看不懂
  let loaded = false;
  try {
    const rgba = new Uint8ClampedArray(buffer);
    if (!sessionPromise) self.postMessage({ id, stage: 'load' });
    await session();
    loaded = true;
    self.postMessage({ id, stage: 'run' });
    const mask = await predict(rgba, width, height);
    const box = subjectBox(mask, width, height);
    const out = composite(rgba, width, height, mask, box);
    self.postMessage({ id, width: box.width, height: box.height, buffer: out.buffer }, [out.buffer]);
  } catch (err) {
    if (err?.message === NO_SUBJECT) self.postMessage({ id, error: NO_SUBJECT });
    else if (loaded) self.postMessage({ id, error: '计算出错' });
    // 推理库载入失败一次就不肯再试，所以让主线程把这个 Worker 换掉（restart）
    else self.postMessage({ id, error: '组件无法载入，可能是设备不支持或没联网', restart: true });
  }
};
