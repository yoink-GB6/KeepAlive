import * as THREE from 'three';
import { glowPoints, glowLines } from './util.js';

const PERIOD = 3.6; // 一次脉动的秒数
const WRAP = 64;    // 脉动计数每 64 次归零；着色器里所有随时间变化的项都以它的约数为周期，长时间运行不丢精度
const TAU = Math.PI * 2;

// 所有顶点都用"伞面坐标"描述，形状和动作全在着色器里算：
// position = (绕轴角度, 伞面经向位置 0 顶 → 1 伞缘, 沿触手的位置 0 根 → 1 梢)
// aB = (触手长度, 摆动相位, 口腕褶边的横向位置 -1..1, 伞高比例)
// aC = (颜色, 点的直径)
const VERTEX = `
  attribute vec4 aB;
  attribute vec4 aC;
  uniform float uPh;
  const float TAU = 6.2831853;

  // 快收慢放，返回 0..1
  float pulse(float ph) {
    float p = fract(ph);
    return p < 0.2 ? smoothstep(0.0, 0.2, p) : 1.0 - smoothstep(0.2, 1.0, p);
  }

  void particle(out vec3 pos, out float size, out vec3 col) {
    float th = position.x, u = position.y, s = position.z;
    float len = s * aB.x;
    // 收缩从伞顶传到伞缘，再顺着触手往下传，离得越远越滞后
    float lag = 0.1 * u + 0.8 * len;
    float c = pulse(uPh - lag);

    float phi = u * (1.9 + 0.3 * c); // 超过 90° 的部分就是向内卷的伞缘
    float rad = 0.63 * (1.0 - 0.27 * c * u) * sin(phi);
    float y = 0.42 * aB.w * (1.0 + 0.16 * c) * cos(phi)
      + 0.02 * u * u * u * u * cos(16.0 * th); // 伞缘的波浪边

    vec2 er = vec2(cos(th), sin(th));
    vec2 et = vec2(-er.y, er.x);
    float wave = TAU * (uPh - 1.3 * len) + aB.y;
    rad = rad * (1.0 - 0.35 * s) + 0.05 * len * sin(wave);
    float tang = 0.11 * len * sin(0.5 * wave + 2.0 * aB.y);

    // 口腕是一条边走边扭的带子，边缘起褶
    float f = aB.z;
    float tw = 3.0 * s + aB.y;
    vec2 frill = (cos(tw) * et + sin(tw) * er) * f * 0.085 * (1.0 - 0.45 * s)
      + er * abs(f) * 0.03 * sin(24.0 * s - TAU * uPh + aB.y);

    vec2 xz = er * rad + et * tang + frill;
    float bob = 0.07 * pulse(uPh - 0.12 - 0.8 * len); // 每收缩一次整体往上一窜，触手跟着被拖上去
    pos = vec3(xz.x, 0.32 + y - len + bob, xz.y);
    size = aC.w;
    col = aC.rgb * (1.0 + 0.6 * c);
  }`;

// 往一组数组里追加顶点，最后一起做成几何体
function builder() {
  const a = [], b = [], c = [];
  return {
    add(th, u, s, len, phase, frill, hk, col, k, size) {
      a.push(th, u, s);
      b.push(len, phase, frill, hk);
      c.push(col.r * k, col.g * k, col.b * k, size);
    },
    geometry() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      geo.setAttribute('aB', new THREE.Float32BufferAttribute(b, 4));
      geo.setAttribute('aC', new THREE.Float32BufferAttribute(c, 4));
      return geo;
    },
  };
}

export default function jellyfish() {
  const group = new THREE.Group();
  const pts = builder();
  const lin = builder();
  const col = new THREE.Color();
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

  const top = new THREE.Color(0x6a5cff);
  const mid = new THREE.Color(0x2fd4ff);
  const edge = new THREE.Color(0xc8f6ff);
  const pink = new THREE.Color(0xff6fd0);
  const violet = new THREE.Color(0x9a6bff);
  const RIBS = 16;

  // 伞面：按面积均匀撒点，辐管位置的点更亮
  const N = 2600;
  const cosEnd = Math.cos(1.9);
  for (let i = 0; i < N; i++) {
    const u = Math.acos(1 - ((i + 0.5) / N) * (1 - cosEnd)) / 1.9;
    const th = i * 2.399963;
    const rib = Math.abs(Math.cos((th * RIBS) / 2)) ** 8;
    col.copy(top).lerp(mid, Math.min(1, u * 1.6));
    pts.add(th, u, 0, 0, 0, 0, 1, col, 0.2 + 0.6 * rib + 0.2 * u * u, 0.02);
  }
  // 伞缘：一圈亮边
  for (let i = 0; i < 360; i++) {
    col.copy(edge).lerp(pink, Math.random() * 0.35);
    pts.add(rnd(0, TAU), rnd(0.96, 1), 0, 0, 0, 0, 1, col, rnd(0.4, 0.8), 0.026);
  }
  // 内层伞面，矮一些，让伞体有厚度
  for (let i = 0; i < 700; i++) {
    const u = Math.sqrt(Math.random()) * 0.92;
    pts.add(rnd(0, TAU), u, 0, 0, 0, 0, 0.6, violet, 0.3, 0.02);
  }
  // 四个粉色的环（生殖腺），水母最好认的特征之一
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * TAU;
      pts.add(k * TAU / 4 + 0.6 + 0.42 * Math.cos(a), 0.36 + 0.13 * Math.sin(a), 0, 0, 0, 0, 0.8, pink, 0.75, 0.028);
    }
  }

  // 辐管和三圈环线
  for (let k = 0; k < RIBS; k++) {
    const th = (k / RIBS) * TAU;
    for (let i = 0; i < 20; i++) {
      for (const u of [i / 20, (i + 1) / 20]) {
        col.copy(top).lerp(mid, Math.min(1, u * 1.6));
        lin.add(th, u, 0, 0, 0, 0, 1, col, 0.9, 0);
      }
    }
  }
  for (const [u, k] of [[0.5, 0.3], [0.8, 0.4], [1, 1]]) {
    for (let i = 0; i < 96; i++) {
      lin.add((i / 96) * TAU, u, 0, 0, 0, 0, 1, edge, k, 0);
      lin.add(((i + 1) / 96) * TAU, u, 0, 0, 0, 0, 1, edge, k, 0);
    }
  }

  // 口腕：从伞心垂下的几条粗褶带
  const ARMS = 5;
  for (let k = 0; k < ARMS; k++) {
    const th = (k / ARMS) * TAU + 0.3;
    const len = rnd(0.62, 0.78);
    const phase = rnd(0, TAU);
    for (let i = 0; i < 300; i++) {
      const s = Math.random() ** 0.8;
      const f = Math.sign(Math.random() - 0.5) * Math.sqrt(Math.random()); // 偏向边缘，褶边更清楚
      col.copy(pink).lerp(violet, s);
      pts.add(th, 0.1, s, len, phase, f, 0.5, col, (1 - 0.6 * s) * rnd(0.5, 0.9), 0.024);
    }
  }

  // 触手：细线加上一串光点，越往梢越暗
  const TENTACLES = 30;
  const SEG = 26;
  const BEADS = 36;
  for (let k = 0; k < TENTACLES; k++) {
    const th = ((k + rnd(-0.25, 0.25)) / TENTACLES) * TAU;
    const len = k % 2 ? rnd(0.55, 0.75) : rnd(0.8, 1);
    const phase = rnd(0, TAU);
    const tint = (s) => col.copy(mid).lerp(violet, s);
    for (let i = 0; i < SEG; i++) {
      for (const s of [i / SEG, (i + 1) / SEG]) lin.add(th, 1, s, len, phase, 0, 1, tint(s), 0.7 * (1 - 0.75 * s), 0);
    }
    for (let i = 0; i < BEADS; i++) {
      const s = (i + Math.random()) / BEADS;
      pts.add(th, 1, s, len, phase, 0, 1, tint(s), 0.8 * (1 - 0.7 * s), 0.022 - 0.008 * s);
    }
  }

  const uPh = { value: 0 }; // 点和线共用同一个 uniform
  group.add(glowPoints(pts.geometry(), VERTEX, { uPh }), glowLines(lin.geometry(), VERTEX, { uPh }));

  let ph = 0;
  return {
    object: group,
    update(dt) {
      ph = (ph + dt / PERIOD) % WRAP;
      uPh.value = ph;
      // 整体缓慢地左右晃
      group.rotation.z = 0.06 * Math.sin((TAU * ph) / 4);
      group.rotation.x = 0.05 * Math.sin((TAU * ph) / 8 + 1);
    },
  };
}
