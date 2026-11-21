import * as THREE from 'three';

// 屏幕上的四块画面：下、右、上、左（屏幕坐标 y 向上）。
// 值是从屏幕中心指向该块的单位向量，也就是站在那一侧的观看者所在的方向。
const TILES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export class QuadView {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.fov = 30;
    this.fitRadius = 1.2; // 场景内容应保持在半径 1 以内
    this.fade = 1;
    this.comp = new THREE.Scene();
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this._size = new THREE.Vector2();

    const ext = renderer.extensions;
    const float = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, toneMapped: false });

    this.tiles = TILES.map((dir) => {
      const cam = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 50);
      const target = new THREE.WebGLRenderTarget(256, 256, {
        type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
        samples: 4,
      });
      // 8 位缓冲存线性颜色会在暗部出现色带，改存 sRGB
      if (!float) target.texture.colorSpace = THREE.SRGBColorSpace;

      const position = new THREE.BufferAttribute(new Float32Array(12), 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', position);
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.MeshBasicMaterial({
        map: target.texture,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const quad = new THREE.Mesh(geo, mat);
      quad.frustumCulled = false;
      this.comp.add(quad);

      const outlineGeo = new THREE.BufferGeometry();
      outlineGeo.setAttribute('position', position);
      const outline = new THREE.LineLoop(outlineGeo, lineMat);
      outline.frustumCulled = false;
      this.comp.add(outline);

      return { dir, cam, target, position, mat, outline };
    });

    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.cross = new THREE.LineSegments(crossGeo, lineMat);
    this.cross.frustumCulled = false;
    this.comp.add(this.cross);
  }

  layout(w, h, s) {
    const R = Math.min(w, h) / 2;
    const o = this.ortho;
    o.left = -w / 2; o.right = w / 2; o.top = h / 2; o.bottom = -h / 2;
    o.updateProjectionMatrix();

    const a = s.size * R;  // 每块画面的半边长
    const c = s.dist * R;  // 画面中心到屏幕中心的距离
    const px = Math.max(128, Math.min(2048, Math.ceil(2 * a)));
    const fl = s.flip ? -1 : 1;    // 画面顶部朝外（默认）或朝内
    const mx = s.mirror ? 1 : -1;  // 是否抵消反射造成的左右颠倒
    const order = s.reverse ? -1 : 1;
    const D = this.fitRadius / Math.sin(THREE.MathUtils.degToRad(this.fov / 2));
    const e = THREE.MathUtils.degToRad(s.elevation);

    for (const t of this.tiles) {
      const [rx, ry] = t.dir;
      const tx = -ry, ty = rx; // 该侧观看者的右手方向
      CORNERS.forEach(([u, v], k) => {
        t.position.setXYZ(
          k,
          rx * c + a * (u * mx * tx + v * fl * rx),
          ry * c + a * (u * mx * ty + v * fl * ry),
          0,
        );
      });
      t.position.needsUpdate = true;
      if (t.target.width !== px) t.target.setSize(px, px);

      // 屏幕俯视图与世界坐标的对应：屏幕 x = 世界 X，屏幕 y = 世界 -Z
      t.cam.position.set(rx * order * D * Math.cos(e), D * Math.sin(e), -ry * D * Math.cos(e));
      t.cam.lookAt(0, 0, 0);
    }

    const k = R * 0.06;
    const p = this.cross.geometry.attributes.position;
    p.setXYZ(0, -k, 0, 0); p.setXYZ(1, k, 0, 0);
    p.setXYZ(2, 0, -k, 0); p.setXYZ(3, 0, k, 0);
    p.needsUpdate = true;
  }

  render(s) {
    const r = this.renderer;
    r.getDrawingBufferSize(this._size);
    this.layout(this._size.x, this._size.y, s);

    for (const t of this.tiles) {
      r.setRenderTarget(t.target);
      r.render(this.scene, t.cam);
      t.mat.color.setScalar(s.brightness * this.fade);
      t.outline.visible = s.calib;
    }
    this.cross.visible = s.calib;
    r.setRenderTarget(null);
    r.render(this.comp, this.ortho);
  }
}
