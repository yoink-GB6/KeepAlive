import * as THREE from 'three';
import { dotTexture } from './util.js';

const H = 256;
const RADIUS = 0.85;
const FONT = `bold 150px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`;
const GAP = 90;
const IDEAL_WIDTH = 2600; // 画布宽度接近这个值时，文字在圆环上的大小最合适（一眼能看到十来个字符）
const MAX_WIDTH = 4096;

// 画布宽度正好等于文字重复若干次的总宽，这样文字铺满一整圈，不留空白段。
// 返回贴图和画布的宽高比，圆环的高度由宽高比决定，文字不会被拉伸。
function textTexture(text) {
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = FONT;
  const w = g.measureText(text).width + GAP;
  const repeat = Math.max(1, Math.round(IDEAL_WIDTH / w));
  const full = w * repeat;
  const k = Math.min(1, MAX_WIDTH / full); // 文字特别长时整体缩小

  c.width = Math.ceil(full * k);
  c.height = Math.ceil(H * k);
  g = c.getContext('2d'); // 改尺寸会重置画布状态
  g.scale(c.width / full, c.height / H);
  g.font = FONT;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const grad = g.createLinearGradient(0, 40, 0, H - 40);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#6fdcff');
  g.fillStyle = grad;
  g.shadowColor = '#2fb8ff';
  g.shadowBlur = 24;
  for (let i = 0; i < repeat; i++) g.fillText(text, w * (i + 0.5), H / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: full / H };
}

export default function textring({ text }) {
  const group = new THREE.Group();
  const { tex, aspect } = textTexture((text || '').trim() || '✦');
  const height = (2 * Math.PI * RADIUS) / aspect;
  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, height, 96, 1, true);

  // 外侧正常显示；内侧（透过圆环看到的背面）调暗，保留一点通透感
  const side = (s, opacity) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex,
    side: s,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(side(THREE.BackSide, 0.22), side(THREE.FrontSide, 1));

  // 中间的水晶：切面靠环境光分出明暗，棱线和光晕自己发光，在棱锥里才够亮
  const crystal = new THREE.IcosahedronGeometry(0.27, 0);
  const core = new THREE.Mesh(crystal, new THREE.MeshStandardMaterial({
    color: 0x9fe8ff, emissive: 0x1a6f9a, roughness: 0.15, metalness: 0.3, flatShading: true,
  }));
  core.scale.y = 1.35;
  core.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(crystal),
    new THREE.LineBasicMaterial({ color: 0xeaffff }),
  ));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dotTexture(),
    color: 0x3fc8ff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(core, glow);

  return {
    object: group,
    update(dt, t) {
      const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
      core.rotation.y -= dt * 0.9; // 与外环反向转动
      glow.scale.setScalar(0.85 + 0.25 * breath);
      glow.material.opacity = 0.25 + 0.25 * breath;
      core.material.emissiveIntensity = 0.8 + 0.7 * breath;
    },
  };
}
