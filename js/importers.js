import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const MAX_TEXTURE = 1536; // 手机拍的照片动辄上千万像素，缩小后再上传显卡

export function kindOf(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (file.type.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  if (file.type.startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

let gltfLoader;
function loader() {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('vendor/three/libs/draco/gltf/'));
  }
  return gltfLoader;
}

async function modelScene(item) {
  let gltf;
  try {
    gltf = await loader().parseAsync(await item.blob.arrayBuffer(), '');
  } catch (e) {
    throw new Error('模型无法解析，请使用单文件的 .glb 格式');
  }
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('模型里没有可显示的内容');
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  root.position.sub(center);

  // 模型绕竖直轴旋转，所以水平方向按对角线算占用半径
  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar(0.9 / Math.max(half.y, Math.hypot(half.x, half.z), 1e-6));

  let mixer = null;
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(gltf.animations[0]).play();
  }
  return {
    object: wrap,
    update(dt) { mixer?.update(dt); },
    dispose() { mixer?.stopAllAction(); },
  };
}

async function imageTexture(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error('图片格式不支持'); }
  const k = Math.min(1, MAX_TEXTURE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: c.width / c.height, dispose() { texture.dispose(); } };
}

async function videoTexture(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.loop = true;
  v.muted = true; // 不静音的话浏览器不允许自动播放
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.src = url;
  const release = () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); };
  try {
    await new Promise((resolve, reject) => {
      v.onloadeddata = resolve;
      v.onerror = () => reject(new Error('视频格式不支持'));
    });
  } catch (e) {
    release();
    throw e;
  }
  v.play().catch(() => {});
  const texture = new THREE.VideoTexture(v);
  texture.colorSpace = THREE.SRGBColorSpace;
  return {
    texture,
    aspect: (v.videoWidth || 16) / (v.videoHeight || 9),
    dispose() { texture.dispose(); release(); },
  };
}

const mediaTexture = (item) => (item.kind === 'video' ? videoTexture(item.blob) : imageTexture(item.blob));

const mediaMaterial = (texture) => new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });

// 单张照片或视频：四个方向各放一面，每一侧的人都正对着画面
async function mediaScene(item) {
  const media = await mediaTexture(item);
  const w = Math.min(1.5, 1.5 * media.aspect);
  const h = w / media.aspect;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = mediaMaterial(media.texture);
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (k * Math.PI) / 2;
    m.translateZ(w / 2);
    group.add(m);
  }
  return { object: group, spin: false, update() {}, dispose: media.dispose };
}

// 多张照片或视频：贴在棱柱各个侧面上缓慢旋转
export async function albumScene(items) {
  if (!items.length) throw new Error('还没有导入照片或视频');
  const results = await Promise.allSettled(items.map(mediaTexture));
  const medias = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!medias.length) throw new Error('照片和视频都无法读取');

  const faces = medias.slice();
  while (faces.length < 4) faces.push(...medias); // 不足四面时重复
  const n = faces.length;
  const W = Math.min(1.3, 2 * 0.95 * Math.sin(Math.PI / n));
  const H = 1.4;
  const apothem = W / (2 * Math.tan(Math.PI / n));

  const group = new THREE.Group();
  const mats = new Map();
  faces.forEach((media, k) => {
    const w = Math.min(W * 0.96, H * media.aspect);
    if (!mats.has(media)) mats.set(media, mediaMaterial(media.texture));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / media.aspect), mats.get(media));
    m.rotation.y = (k * 2 * Math.PI) / n;
    m.translateZ(apothem);
    group.add(m);
  });
  return { object: group, update() {}, dispose() { medias.forEach((m) => m.dispose()); } };
}

export function itemScene(item) {
  return item.kind === 'model' ? modelScene(item) : mediaScene(item);
}
