import * as THREE from 'three';
import { dotTexture } from './util.js';

const R = 0.8;

function onSphere(lat, lon, r = R) {
  return new THREE.Vector3(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  );
}

function segments(verts, color, opacity = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(verts);
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

export default function globe() {
  const group = new THREE.Group();
  group.rotation.z = 0.41; // 地轴倾角

  const grid = [];
  const STEP = Math.PI / 9;
  const SEG = 72;
  for (let lat = -Math.PI / 2 + STEP; lat < Math.PI / 2 - 1e-6; lat += STEP) {
    for (let i = 0; i < SEG; i++) {
      grid.push(onSphere(lat, (i / SEG) * Math.PI * 2), onSphere(lat, ((i + 1) / SEG) * Math.PI * 2));
    }
  }
  for (let lon = 0; lon < Math.PI * 2 - 1e-6; lon += STEP) {
    for (let i = 0; i < SEG / 2; i++) {
      const l0 = -Math.PI / 2 + (i / (SEG / 2)) * Math.PI;
      const l1 = -Math.PI / 2 + ((i + 1) / (SEG / 2)) * Math.PI;
      grid.push(onSphere(l0, lon), onSphere(l1, lon));
    }
  }
  group.add(segments(grid, 0x2fc8ff));

  // 黑色球体挡住背面的线条，轮廓更清楚（黑色在棱锥里是透明的）
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.985, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  ));

  const cities = [];
  for (let i = 0; i < 40; i++) {
    cities.push(onSphere(Math.asin(Math.random() * 1.6 - 0.8), Math.random() * Math.PI * 2, R * 1.01));
  }
  const cityGeo = new THREE.BufferGeometry().setFromPoints(cities);
  group.add(new THREE.Points(cityGeo, new THREE.PointsMaterial({
    size: 0.06,
    map: dotTexture(),
    color: 0xffe08a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })));

  // 城市之间的飞线
  const arcs = [];
  for (let i = 0; i < 10; i++) {
    const p0 = cities[i * 2];
    const p1 = cities[i * 2 + 1];
    const mid = p0.clone().add(p1).normalize().multiplyScalar(R * (1.05 + p0.distanceTo(p1) * 0.12));
    const pts = new THREE.QuadraticBezierCurve3(p0, mid, p1).getPoints(24);
    for (let k = 0; k < pts.length - 1; k++) arcs.push(pts[k], pts[k + 1]);
  }
  group.add(segments(arcs, 0xff7a3d));

  return { object: group, update() {} };
}
