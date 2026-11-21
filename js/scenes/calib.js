import * as THREE from 'three';

function face(label, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.strokeRect(7, 7, 242, 242);
  g.fillStyle = color;
  g.font = 'bold 170px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

// 校准方块：站在屏幕下边缘一侧应看到正立、不反字的"前"，
// 逆时针绕到屏幕右侧应看到"右"，对面是"后"，左侧是"左"。
export default function calib() {
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.05, 1.05),
    // 材质顺序：+X、-X、+Y、-Y、+Z、-Z
    [face('右', '#ffd23f'), face('左', '#3fd0ff'), face('上', '#ffffff'), face('下', '#888888'), face('前', '#ff4f7b'), face('后', '#6dff8a')],
  );
  return { object: cube, spin: false, update() {} };
}
