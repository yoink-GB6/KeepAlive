import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'];
const MAX_TEXTURE = 1536; // 手机拍的照片动辄上千万像素，缩小后再上传显卡

export function kindOf(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (file.type.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  if (file.type.startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video';
  if (file.type.startsWith('audio/') || AUDIO_EXT.includes(ext)) return 'audio';
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

// 把颜色贴图和自发光贴图画到一张画布上相加，换成不受光照的叠加材质
function glowMaterial(src, level) {
  const maps = [src.map, src.emissiveMap].filter((t) => t?.image);
  const out = new THREE.MeshBasicMaterial({
    side: src.side,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  out.color.copy(maps.length ? new THREE.Color(1, 1, 1) : src.color).multiplyScalar(level);
  if (maps.length) {
    const c = document.createElement('canvas');
    c.width = maps[0].image.width;
    c.height = maps[0].image.height;
    const g = c.getContext('2d');
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'lighter';
    for (const t of maps) g.drawImage(t.image, 0, 0, c.width, c.height);
    out.map = new THREE.CanvasTexture(c);
    out.map.flipY = maps[0].flipY;
    out.map.wrapS = maps[0].wrapS;
    out.map.wrapT = maps[0].wrapT;
    out.map.colorSpace = THREE.SRGBColorSpace;
  }
  for (const t of maps) t.dispose();
  src.dispose();
  return out;
}

function liftShadows(material, gamma) {
  if (material.userData.gamma) return; // 多个网格共用同一个材质
  material.userData.gamma = gamma;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\ndiffuseColor.rgb = pow(diffuseColor.rgb, vec3(${gamma.toFixed(3)}));`,
    );
  };
  material.customProgramCacheKey = () => `gamma${gamma}`;
}

// 当前姿态下的包围盒。蒙皮网格的包围盒要按骨骼现算，否则拿到的是绑定姿态的
function poseBox(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    o.computeBoundingBox();
  });
  return new THREE.Box3().setFromObject(root);
}

// tune 是可选的微调：
//   rotate   [x, y, z] 角度，适配大小之前先把模型摆正
//   scale    在自动适配的基础上再缩放
//   hide     名字匹配这个正则的网格不显示，也不参与适配；匹配的骨骼缩成一个点，它带动的那部分跟着消失
//   glow     贴图是黑底发光图案的模型：不受光照，颜色贴图和自发光贴图合在一起叠加绘制，黑的地方就是透明。
//            值是亮度，层层相叠太白就调低
//   color    覆盖材质的底色（纯白的模型打上光会糊成一片，看不出起伏）
//   gamma    小于 1 时把颜色的暗部提亮（棱锥里深色几乎看不见），亮部基本不变
async function modelScene(blob, tune = {}) {
  let gltf;
  try {
    gltf = await loader().parseAsync(await blob.arrayBuffer(), '');
  } catch (e) {
    throw new Error('模型无法解析，请使用单文件的 .glb 格式');
  }
  const root = gltf.scene;
  if (tune.rotate) root.rotation.set(...tune.rotate.map(THREE.MathUtils.degToRad));
  const hidden = [];
  const glows = new Map(); // 原材质 -> 换上的材质，多个网格共用材质时只换一次
  let mixer = null;
  let skinned = 0;
  root.traverse((o) => {
    if (o.isBone && tune.hide?.test(o.name)) o.scale.setScalar(0);
    if (!o.isMesh) return;
    if (tune.hide?.test(o.name)) return hidden.push(o);
    if (tune.glow) {
      if (!glows.has(o.material)) glows.set(o.material, glowMaterial(o.material, tune.glow));
      o.material = glows.get(o.material);
    }
    if (tune.color !== undefined) o.material.color.set(tune.color);
    if (tune.gamma) liftShadows(o.material, tune.gamma);
    if (!o.isSkinnedMesh) return;
    skinned += o.geometry.attributes.position.count;
    o.frustumCulled = false; // 裁剪用的包围球不跟着动画变，动作大了会被误裁掉
  });
  for (const o of hidden) o.removeFromParent(); // 还没画过，显卡里没有它的东西，拿掉就行
  const box = poseBox(root);
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations[0];
    mixer.clipAction(clip).play();
    // 把整段动画扫一遍取并集，翅膀张到最开时也不会出画。顶点多的模型少采几帧
    const n = Math.max(4, Math.min(32, Math.round(1e6 / (skinned + 1))));
    for (let i = 1; i < n; i++) {
      mixer.setTime((clip.duration * i) / n);
      box.union(poseBox(root));
    }
    mixer.setTime(0);
  }
  if (box.isEmpty()) throw new Error('模型里没有可显示的内容');
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  // 模型绕竖直轴旋转，所以水平方向按对角线算占用半径
  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar(((tune.scale ?? 1) * 0.9) / Math.max(half.y, Math.hypot(half.x, half.z), 1e-6));
  wrap.position.copy(center).multiplyScalar(-wrap.scale.x);

  return {
    object: wrap,
    update(dt) { mixer?.update(dt); },
    dispose() { mixer?.stopAllAction(); },
  };
}

// 随应用发布的模型：从服务器取文件，之后和导入的模型走同一条路。
// 文件内容留在内存里，同一次打开期间再切回来不用重新下载
const fetched = new Map();
export async function fileModelScene({ file, ...tune }) {
  if (!fetched.has(file)) {
    fetched.set(file, fetch(file).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    }));
  }
  let blob;
  try {
    blob = await fetched.get(file);
  } catch (e) {
    fetched.delete(file); // 下次再试
    throw new Error('模型下载失败，请联网后重试');
  }
  return modelScene(blob, tune);
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
    video: v,
    aspect: (v.videoWidth || 16) / (v.videoHeight || 9),
    dispose() { texture.dispose(); release(); },
  };
}

// 抠过图的照片同时存着原图（blob）和抠好的图（cut），plain 为真表示用户选了看原图
const mediaTexture = (item) => (item.kind === 'video'
  ? videoTexture(item.blob)
  : imageTexture(item.cut && !item.plain ? item.cut : item.blob));

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
  // video 交给外面决定要不要出声；相册里的视频不暴露，始终静音
  return { object: group, spin: false, video: media.video, update() {}, dispose: media.dispose };
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

// 背景音乐播放器。能读出元数据才算可用，导入时靠它验证文件
export async function audioPlayer(blob) {
  const url = URL.createObjectURL(blob);
  const el = new Audio();
  el.loop = true;
  el.src = url;
  const dispose = () => { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); };
  try {
    await new Promise((resolve, reject) => {
      el.onloadedmetadata = resolve;
      el.onerror = () => reject(new Error('音频格式不支持'));
    });
  } catch (e) {
    dispose();
    throw e;
  }
  return { el, dispose };
}

export function itemScene(item) {
  return item.kind === 'model' ? modelScene(item.blob) : mediaScene(item);
}
