import * as THREE from 'three';
import { dotTexture } from './util.js';

function points(count, fill, size) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    fill(p, c);
    p.toArray(pos, i * 3);
    c.toArray(col, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size,
    map: dotTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
}

export default function galaxy() {
  const group = new THREE.Group();
  group.rotation.z = 0.42;

  const a = new THREE.Color(0x38e8ff);
  const b = new THREE.Color(0xb060ff);
  const planet = points(2600, (p, c) => {
    p.randomDirection().multiplyScalar(0.5);
    // 按纬度分出色带
    c.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(p.y * 22));
  }, 0.028);
  group.add(planet);

  const warm = new THREE.Color(0xffd27a);
  const pink = new THREE.Color(0xff6fae);
  const ring = points(3200, (p, c) => {
    const ang = Math.random() * Math.PI * 2;
    const r = 0.68 + Math.random() * 0.3;
    p.set(Math.cos(ang) * r, (Math.random() - 0.5) * 0.02, Math.sin(ang) * r);
    c.copy(warm).lerp(pink, (r - 0.68) / 0.3).multiplyScalar(0.5 + Math.random() * 0.5);
  }, 0.02);
  group.add(ring);

  return {
    object: group,
    update(dt) {
      planet.rotation.y += dt * 0.25;
      ring.rotation.y -= dt * 0.12;
    },
  };
}
