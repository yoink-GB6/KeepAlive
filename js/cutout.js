// 自动抠图：留下照片里的主体，背景涂成纯黑（棱锥里黑色就是透明），并裁到主体大小。
// 全程在本机完成，照片不上传。推理库和模型很大，由 Worker 在第一次用到时才载入；
// 这个文件本身很小，跟着主程序一起加载不影响启动。

const MAX_SIDE = 1536; // 和 importers.js 的贴图上限一致，再大也显示不出来
const TIMEOUT = 120000; // 老手机上可能要十几秒；到这个时间还没结果就当失败
const IDLE = 60000; // 闲置一分钟后关掉 Worker，把模型占的内存还回去

let worker = null;
let idleTimer;
let seq = 0;
const jobs = new Map(); // id -> { resolve, reject, onStage }

function stop(reason) {
  worker?.terminate();
  worker = null;
  for (const job of jobs.values()) job.reject(new Error(reason));
  jobs.clear();
}

function start() {
  worker = new Worker(new URL('./cutout-worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if (data.stage) return job.onStage(data.stage);
    jobs.delete(data.id);
    if (data.restart) stop(); // 载入失败的 Worker 不能再用，下次重新开一个
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data);
  };
  // 脚本本身载入失败（比如断网又没缓存过）会走到这里
  worker.onerror = (e) => {
    e.preventDefault();
    stop('组件无法载入，可能是设备不支持或没联网');
  };
}

function run(image, onStage) {
  clearTimeout(idleTimer);
  if (!worker) start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stop('用时太长'), TIMEOUT);
    const done = (fn) => (value) => {
      clearTimeout(timer);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop('已关闭'), IDLE);
      fn(value);
    };
    jobs.set(id, { resolve: done(resolve), reject: done(reject), onStage });
    worker.postMessage({ id, width: image.width, height: image.height, buffer: image.data.buffer }, [image.data.buffer]);
  });
}

// 返回抠好的图（黑底 JPEG）。失败时抛出带中文说明的错误，由调用方决定怎么退回。
// onStage('load') 表示正在载入模型，onStage('run') 表示开始计算。
// 一次只算一张：前一批还没抠完又导入一批时排队，免得几张大图同时占着内存
let queue = Promise.resolve();
export function cutout(blob, onStage = () => {}) {
  const result = queue.then(() => cutoutNow(blob, onStage));
  queue = result.catch(() => {});
  return result;
}

async function cutoutNow(blob, onStage) {
  if (!window.Worker || !window.WebAssembly) throw new Error('这台设备不支持');
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error('图片格式不支持'); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillRect(0, 0, c.width, c.height); // 带透明通道的图片先垫上黑底
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();

  const res = await run(g.getImageData(0, 0, c.width, c.height), onStage);
  c.width = res.width;
  c.height = res.height;
  g.putImageData(new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height), 0, 0);
  // 没有透明通道要存，JPEG 就够了，一张几百 KB
  const out = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
  if (!out) throw new Error('无法生成图片');
  return out;
}
