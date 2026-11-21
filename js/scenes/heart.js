import * as THREE from 'three';
import { dotTexture } from './util.js';

export function heartGeometry(radius) {
  const s = new THREE.Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 5,
    bevelEnabled: true,
    bevelThickness: 2.5,
    bevelSize: 2,
    bevelSegments: 8,
    curveSegments: 24,
  });
  geo.rotateZ(Math.PI); // 原始形状尖端朝上
  geo.center();
  geo.computeBoundingSphere();
  const k = radius / geo.boundingSphere.radius;
  geo.scale(k, k, k);
  return geo;
}

// 两下一组的心跳，返回 0..1
export function heartbeat(t) {
  const p = (t * 1.1) % 1;
  return Math.exp(-14 * p) + 0.6 * Math.exp(-40 * (p - 0.28) ** 2);
}

export default function heart() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    heartGeometry(0.72),
    new THREE.MeshStandardMaterial({ color: 0xff1f4f, emissive: 0x8a0020, roughness: 0.25, metalness: 0.2 }),
  );
  group.add(mesh);

  const N = 160;
  const pos = new Float32Array(N * 3);
  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 0.35;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 1.8 - 0.9;
    pos[i * 3 + 2] = Math.sin(a) * r;
    speed[i] = 0.05 + Math.random() * 0.15;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.05,
    map: dotTexture(),
    color: 0xff8fb0,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(sparks);

  return {
    object: group,
    update(dt, t) {
      mesh.scale.setScalar(1 + 0.09 * heartbeat(t));
      for (let i = 0; i < N; i++) {
        let y = pos[i * 3 + 1] + speed[i] * dt;
        if (y > 0.9) y = -0.9;
        pos[i * 3 + 1] = y;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
