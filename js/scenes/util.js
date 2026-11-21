import * as THREE from 'three';

let dot;
// 柔和的圆形光点贴图，粒子共用
export function dotTexture() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

// 自发光的粒子 / 细线材质：位置在顶点着色器里随时间算出，CPU 每帧只改几个 uniform。
// vertex 里要定义 void particle(out vec3 pos, out float size, out vec3 col)，size 是世界单位的直径。
function glowMaterial(vertex, uniforms, lines) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uScale: { value: 300 } },
    vertexShader: `
      uniform float uScale;
      varying vec3 vCol;
      varying float vEdge;
      ${vertex}
      void main() {
        vec3 pos; float size;
        particle(pos, size, vCol);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = size * uScale * projectionMatrix[1][1] / -mv.z;
        gl_PointSize = max(px, 1.5);
        vEdge = 0.75 - 0.75 * smoothstep(2.0, 8.0, px); // 小点画成实心，大点才有柔边，否则小画面里太暗
      }`,
    fragmentShader: lines
      ? 'varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }'
      : `varying vec3 vCol;
      varying float vEdge;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vCol * (1.0 - smoothstep(vEdge, 1.0, d)), 1.0);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// 点的像素大小取决于当前画面的高度，着色器材质拿不到，渲染前补上
function setScale(renderer) {
  const target = renderer.getRenderTarget();
  this.material.uniforms.uScale.value = (target ? target.height : renderer.domElement.height) * 0.5;
}

export function glowPoints(geo, vertex, uniforms) {
  const points = new THREE.Points(geo, glowMaterial(vertex, uniforms, false));
  points.frustumCulled = false; // 包围球是按静止位置算的，不可靠
  points.onBeforeRender = setScale;
  return points;
}

export function glowLines(geo, vertex, uniforms) {
  const lines = new THREE.LineSegments(geo, glowMaterial(vertex, uniforms, true));
  lines.frustumCulled = false;
  return lines;
}

export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}
