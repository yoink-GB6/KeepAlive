import * as THREE from 'three';
import { glowPoints, glowLines } from './util.js';

const SHELLS = 3;   // 同时存在的烟花上限，轮流复用
const SPARKS = 240; // 每发的火花数
const TRAIL = 6;    // 每颗火花的拖尾线段数
const ROCKET = 16;  // 升空尾迹的点数
const REACH = 0.97; // 画面能用的半径

// position = 火花方向 × 速度比例
// aP = (拖尾位置 0 头 → 1 尾, 闪烁相位, 属于内层小球, 类型：0 火花 1 升空弹体 2 爆开的闪光)
const VERTEX = `
  attribute vec4 aP;
  uniform float uAge;   // 发射后经过的秒数
  uniform float uRise;  // 升空用时
  uniform float uLife;  // 爆开后的寿命
  uniform float uR;     // 火花飞到头的半径
  uniform float uDrag;  // 阻力系数
  uniform float uFall;  // 下坠的最终速度
  uniform vec4 uTrail;  // 拖尾回看的秒数 = x + y · 已过时间；z 尾部偏暖色的程度；w 后半段闪烁的程度
  uniform vec4 uRing;   // xyz 环面法线，w 把外层火花压向环面的程度（0 = 普通球壳）
  uniform vec3 uFrom;
  uniform vec3 uAt;
  uniform vec3 uColA;
  uniform vec3 uColB;

  void particle(out vec3 pos, out float size, out vec3 col) {
    float lag = aP.x;
    float tau = uAge - uRise;
    if (aP.w > 1.5) {
      pos = uAt;
      size = 0.6 * uR;
      col = vec3(0.5, 0.47, 0.42) * step(0.0, tau) * exp(-8.0 * tau);
    } else if (aP.w > 0.5) {
      float q = (uAge - 0.15 * lag) / uRise;
      float e = clamp(q, 0.0, 1.0);
      pos = mix(uFrom, uAt, 1.0 - (1.0 - e) * (1.0 - e)); // 越升越慢
      pos.xz += 0.012 * lag * vec2(sin(aP.y + 40.0 * uAge), cos(aP.y * 1.7 + 33.0 * uAge));
      size = 0.04 - 0.02 * lag;
      col = mix(vec3(1.0, 0.9, 0.7), vec3(1.0, 0.45, 0.1), lag) * (1.0 - lag) * step(0.0, q) * step(tau, 0.0);
    } else {
      // 拖尾就是同一颗火花稍早时刻的位置。回看的时间跨度随时间加长：
      // 火花慢下来以后尾巴也不会缩成一个点，整个过程都能看到从中心放射出来的线条
      float head = max(tau, 0.0);
      float t = max(head - lag * (uTrail.x + uTrail.y * head), 0.0);
      float d = 1.0 - exp(-uDrag * t);
      vec3 dir = position - uRing.xyz * (dot(position, uRing.xyz) * uRing.w * (1.0 - aP.z));
      dir = normalize(dir) * length(position);
      pos = uAt + dir * (uR * d);
      pos.y -= uFall * (t - d / uDrag);

      float life = head / uLife;
      float fade = 1.0 - smoothstep(0.55, 1.0, life);
      float tail = smoothstep(0.6 * lag, 0.6 * lag + 0.4, fade); // 熄灭从尾巴开始，头最后灭
      float twinkle = mix(1.0, 0.4 + 0.6 * sin(aP.y + 30.0 * head), uTrail.w * smoothstep(0.35, 0.7, life));
      // 刚爆开时几百颗火花挤在一处，压暗一些，交给闪光去表现，不然中心是一块实心白斑
      float open = (1.0 - exp(-uDrag * head)) / 0.45;
      float spread = clamp(open * open, 0.03, 1.0); // 亮度跟着球面面积涨
      vec3 hue = (aP.z > 0.5 ? uColB : uColA) * mix(vec3(1.0), vec3(1.0, 0.55, 0.3), lag * uTrail.z);
      size = 0.042;
      col = mix(vec3(1.0), hue, (0.5 + 0.5 * smoothstep(0.0, 0.06, life)) * (0.7 + 0.3 * lag))
        * 1.3 * (1.0 - lag) * (1.0 - 0.5 * lag) * tail * twinkle * spread * step(uRise, uAge);
    }
  }`;

function attributes(dir, p) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aP', new THREE.Float32BufferAttribute(p, 4));
  return geo;
}

// 一发烟花的两份几何体：火花头、弹体和闪光是点，拖尾是线
function shellGeometry() {
  const head = { dir: [], p: [] };
  const tail = { dir: [], p: [] };
  const v = new THREE.Vector3();
  const turn = new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
  for (let i = 0; i < SPARKS; i++) {
    // 斐波那契球面加一点抖动：方向分布均匀；速度有快有慢，球壳才不是一层死板的皮
    const y = 1 - (2 * (i + 0.5)) / SPARKS;
    const a = i * 2.399963 + Math.random() * 0.3;
    const inner = i % 5 === 0 ? 1 : 0; // 五分之一的火花组成里面一层小球
    v.set(Math.sqrt(1 - y * y) * Math.cos(a), y, Math.sqrt(1 - y * y) * Math.sin(a))
      .applyEuler(turn)
      .multiplyScalar(inner ? 0.4 + Math.random() * 0.15 : 1 - 0.3 * Math.random() ** 2);
    const phase = Math.random() * 6.28;
    head.dir.push(v.x, v.y, v.z);
    head.p.push(0, phase, inner, 0);
    for (let j = 0; j < TRAIL; j++) {
      tail.dir.push(v.x, v.y, v.z, v.x, v.y, v.z);
      tail.p.push(j / TRAIL, phase, inner, 0, (j + 1) / TRAIL, phase, inner, 0);
    }
  }
  for (let j = 0; j < ROCKET; j++) {
    head.dir.push(0, 0, 0);
    head.p.push(j / ROCKET, Math.random() * 6.28, 0, 1);
  }
  head.dir.push(0, 0, 0);
  head.p.push(0, 0, 0, 2);
  return [attributes(head.dir, head.p), attributes(tail.dir, tail.p)];
}

export default function fireworks() {
  const group = new THREE.Group();
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

  const shells = [];
  for (let i = 0; i < SHELLS; i++) {
    const u = {
      uAge: { value: 1e3 }, // 远大于寿命 = 空闲
      uRise: { value: 1 },
      uLife: { value: 1 },
      uR: { value: 0.5 },
      uDrag: { value: 1.5 },
      uFall: { value: 0.1 },
      uTrail: { value: new THREE.Vector4() },
      uRing: { value: new THREE.Vector4(0, 1, 0, 0) },
      uFrom: { value: new THREE.Vector3() },
      uAt: { value: new THREE.Vector3() },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
    };
    shells.push(u);
    const [heads, tails] = shellGeometry();
    group.add(glowPoints(heads, VERTEX, u), glowLines(tails, VERTEX, u));
  }

  let hue = Math.random();
  let lastKind = -1;
  function launch(u) {
    let kind = Math.random();
    kind = kind < 0.45 ? 0 : kind < 0.75 ? 1 : 2;
    if (kind === lastKind) kind = (kind + 1) % 3; // 连着两发不重样
    lastKind = kind;
    hue = (hue + rnd(0.2, 0.8)) % 1; // 和上一发明显不同色
    u.uRing.value.w = 0;
    if (kind === 0) {
      // 牡丹：放射状的彩色球，后半段闪烁
      u.uDrag.value = 1.5;
      u.uFall.value = rnd(0.06, 0.09);
      u.uLife.value = rnd(2.6, 3);
      u.uTrail.value.set(0.25, 0.4, 0, 1);
      u.uColA.value.setHSL(hue, 1, 0.6);
      if (Math.random() < 0.5) u.uColB.value.setHSL(0.12, 1, 0.75);
      else u.uColB.value.setHSL((hue + rnd(0.3, 0.7)) % 1, 1, 0.6);
    } else if (kind === 1) {
      // 垂柳：金色，阻力小、下坠重，拖着长尾巴垂成伞形
      u.uDrag.value = 1.1;
      u.uFall.value = rnd(0.18, 0.22);
      u.uLife.value = rnd(3.2, 3.6);
      u.uTrail.value.set(0.35, 0.55, 1, 0);
      u.uColA.value.setHSL(rnd(0.1, 0.13), 1, 0.62);
      u.uColB.value.setHSL(0.14, 1, 0.8);
    } else {
      // 土星：外层压成一个斜着的环，里面一个异色小球
      u.uDrag.value = 1.6;
      u.uFall.value = rnd(0.06, 0.09);
      u.uLife.value = rnd(2.5, 2.9);
      u.uTrail.value.set(0.2, 0.35, 0, 1);
      u.uColA.value.setHSL(hue, 1, 0.6);
      u.uColB.value.setHSL((hue + rnd(0.35, 0.65)) % 1, 1, 0.65);
      // 环面的法线斜着指向两个相邻观看方向的中间，四面看过去都是椭圆；正对着某一面的话，旁边两面只能看到一条线
      const tilt = rnd(0.85, 1.15);
      const turn = Math.PI / 4 + Math.floor(rnd(0, 4)) * (Math.PI / 2) + rnd(-0.2, 0.2);
      u.uRing.value.set(Math.sin(tilt) * Math.cos(turn), Math.cos(tilt), Math.sin(tilt) * Math.sin(turn), 0.88);
    }

    // 爆点放在原点上方半个下坠量的位置：刚炸开的球和熄灭前垂下去的球到原点一样远，能用的半径最大
    const seen = 0.9 * u.uLife.value; // 这之后基本看不见了
    const spread = 1 - Math.exp(-u.uDrag.value * seen);
    const droop = u.uFall.value * (seen - spread / u.uDrag.value);
    const at = u.uAt.value.set(rnd(-0.04, 0.04), droop / 2 + rnd(-0.02, 0.02), rnd(-0.04, 0.04));
    const side = Math.hypot(at.x, at.z);
    const reach = REACH - Math.max(Math.hypot(side, at.y), Math.hypot(side, at.y - droop));
    u.uR.value = (reach * (1 - 0.15 * Math.random() ** 2)) / spread; // 多数接近撑满，偶尔小一号
    u.uFrom.value.set(at.x * 0.5, at.y - 0.6, at.z * 0.5);
    u.uRise.value = rnd(0.45, 0.6);
    u.uAge.value = 0;
  }

  // 一上来就有一发正在绽放，另一发刚升空，不用等
  launch(shells[0]);
  shells[0].uAge.value = shells[0].uRise.value + 0.3;
  launch(shells[1]);
  let wait = rnd(1.4, 1.9);

  return {
    object: group,
    // 不随舞台旋转：拖尾和下坠是直的，转起来会被甩成螺旋；四面看到的本来就是同一个球壳的不同侧面
    spin: false,
    update(dt) {
      wait -= dt;
      for (let i = 0; i < SHELLS; i++) {
        const u = shells[i];
        u.uAge.value = Math.min(u.uAge.value + dt, 1e3);
        if (wait <= 0 && u.uAge.value > u.uRise.value + u.uLife.value + 0.1) {
          launch(u);
          wait = rnd(1.6, 2.4);
        }
      }
    },
  };
}
