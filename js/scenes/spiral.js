import * as THREE from 'three';
import { glowPoints } from './util.js';

const TAU = Math.PI * 2;
const LOOP = 720;   // 秒。每颗星的角速度都是 TAU / LOOP 的整数倍，所以整个画面每 LOOP 秒精确回到原样，时间可以取模
const PATTERN = 16; // 旋臂图案的转速（同一单位）：45 秒一圈
const WIND = 2.5;   // 对数螺线 θ = WIND · ln(r / R0)，约 22° 的螺距角
const R0 = 0.12;
const R1 = 0.95;

// position = (轨道半径, 初始角度, 离盘面的高度)
// aOrb = (角速度, 本轮幅度, 本轮频率, 本轮相位)，频率也是整数
// aCol = (颜色, 点的直径)
// aWave：穿过旋臂时变亮的程度
const VERTEX = `
  attribute vec4 aOrb;
  attribute vec4 aCol;
  attribute float aWave;
  uniform float uA; // 0..TAU，LOOP 秒走一圈

  void particle(out vec3 pos, out float size, out vec3 col) {
    float e = aOrb.w + aOrb.z * uA;
    float r = position.x + aOrb.y * sin(e);
    float ang = position.y - aOrb.x * uA; // 顺着旋臂拖尾的方向转
    pos = vec3(r * cos(ang), position.z + 0.3 * aOrb.y * cos(e), r * sin(ang));
    size = aCol.w;
    // 旋臂只是图案：盘面上的星各转各的，路过旋臂时亮起来，离开又暗下去
    float arm = position.y - (aOrb.x - ${PATTERN}.0) * uA - ${WIND.toFixed(2)} * log(max(position.x, 0.01) / ${R0});
    float lit = pow(0.5 + 0.5 * cos(2.0 * arm), 3.0);
    col = aCol.rgb * (0.8 + 0.2 * sin(3.0 * e)) * (1.0 + aWave * (3.0 * lit - 0.6));
  }`;

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73; // 近似标准正态

export default function spiral() {
  const pos = [], orb = [], colors = [], wave = [];
  const c = new THREE.Color();
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  // 转速近似"线速度处处相同"：越靠里角速度越大。r = 0.3 处与旋臂同步
  const omega = (r) => Math.max(4, Math.round(6.4 / (r + 0.1)));
  function star(r, ang, y, speed, epi, color, k, size, w = 0) {
    pos.push(r, ang, y);
    orb.push(speed, epi, Math.round(rnd(20, 60)), rnd(0, TAU));
    colors.push(color.r * k, color.g * k, color.b * k, size);
    wave.push(w);
  }

  const warm = new THREE.Color(0xffc978);
  const cream = new THREE.Color(0xfff1d0);
  const blue = new THREE.Color(0x7fb0ff);
  const white = new THREE.Color(0xeaf2ff);
  const pink = new THREE.Color(0xff4f9a);
  const armAngle = (k, r) => (k * TAU) / 2 + WIND * Math.log(r / R0);

  // 核球：暖色，略扁
  for (let i = 0; i < 1500; i++) {
    const r = Math.abs(gauss()) * 0.085 + 0.004;
    c.copy(cream).lerp(warm, Math.min(1, r / 0.2));
    star(Math.min(r, 0.3), rnd(0, TAU), gauss() * 0.045 * Math.exp(-r / 0.2), omega(r), 0.004, c, 0.55, 0.022);
  }
  // 中心的大光晕
  star(0, 0, 0, PATTERN, 0, warm, 0.5, 0.34);
  star(0, 0, 0, PATTERN, 0, cream, 0.6, 0.16);

  // 两条主旋臂，随图案整体转动，不会越缠越紧
  for (let i = 0; i < 4600; i++) {
    const r = R0 + (R1 - R0 - 0.03) * Math.random() ** 1.2;
    // 一半的星紧贴臂心，一半散得很开，臂才有亮脊和柔和的边，而不是一条线
    const spread = (i % 4 < 2 ? 0.14 : 0.4) + 0.02 / r; // 弧度；臂的实际宽度随半径变宽
    const ang = armAngle(i % 2, r) + gauss() * spread;
    const giant = Math.random() < 0.07;
    c.copy(blue).lerp(white, Math.random()).lerp(warm, Math.max(0, 1 - r / 0.35) * 0.8);
    const fade = 1 - 0.5 * (r / R1) ** 2;
    star(r, ang, gauss() * 0.014, PATTERN, rnd(0.004, 0.014), c, (giant ? 0.9 : rnd(0.2, 0.5)) * fade, giant ? 0.032 : 0.018);
  }
  // 粉色星云团，嵌在旋臂里
  for (let k = 0; k < 12; k++) {
    const r0 = rnd(0.28, 0.86);
    const a0 = armAngle(k % 2, r0) + gauss() * 0.06;
    for (let i = 0; i < 26; i++) {
      const r = r0 + gauss() * 0.025;
      star(r, a0 + (gauss() * 0.025) / r0, gauss() * 0.012, PATTERN, 0.004, pink, rnd(0.5, 0.85), 0.038);
    }
  }
  // 盘面上的散星：较差自转（里快外慢）就体现在它们身上
  for (let i = 0; i < 1800; i++) {
    const r = R0 + (R1 - R0 - 0.03) * Math.sqrt(Math.random());
    c.copy(white).lerp(warm, Math.random() * 0.6);
    star(r, rnd(0, TAU), gauss() * 0.02, omega(r), 0.01, c, 0.2, 0.018, 1);
  }
  // 稀疏的球状晕
  const v = new THREE.Vector3();
  for (let i = 0; i < 400; i++) {
    v.randomDirection().multiplyScalar(rnd(0.25, 0.9));
    v.y *= 0.6;
    star(Math.hypot(v.x, v.z), Math.atan2(v.z, v.x), v.y, omega(v.length()), 0.006, white, 0.2, 0.018);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aOrb', new THREE.Float32BufferAttribute(orb, 4));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(colors, 4));
  geo.setAttribute('aWave', new THREE.Float32BufferAttribute(wave, 1));
  const uA = { value: 0 };
  const disc = glowPoints(geo, VERTEX, { uA });
  disc.rotation.order = 'YXZ';

  let time = 0;
  return {
    object: disc,
    // 不随舞台旋转：盘面朝两个相邻观看方向的正中间倾斜，四面看到的都是同样饱满的椭圆；
    // 跟着舞台转的话，每转四分之一圈就有两面只能看到一条线
    spin: false,
    update(dt) {
      time = (time + dt) % LOOP;
      uA.value = (time / LOOP) * TAU;
      // 轻微的进动，周期是 LOOP 的约数
      disc.rotation.x = 1.05 + 0.07 * Math.sin(uA.value * 20);
      disc.rotation.y = Math.PI / 4 + 0.16 * Math.sin(uA.value * 30 + 1);
    },
  };
}
