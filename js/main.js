import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QuadView } from './quadview.js';
import { loadSettings, saveSettings, listItems, addItem, deleteItem } from './store.js';
import { disposeObject } from './scenes/util.js';
import heart from './scenes/heart.js';
import galaxy from './scenes/galaxy.js';
import globe from './scenes/globe.js';
import textring from './scenes/textring.js';
import calib from './scenes/calib.js';
import { kindOf, itemScene, albumScene } from './importers.js';
import { initUI } from './ui.js';

const BUILTINS = [
  { id: 'heart', name: '跳动的心', make: heart },
  { id: 'galaxy', name: '粒子星球', make: galaxy },
  { id: 'globe', name: '线框地球', make: globe },
  { id: 'text', name: '文字环', make: textring },
];
const KIND_LABEL = { model: '模型', image: '照片', video: '视频' };
const FADE_SECONDS = 0.35;

const settings = loadSettings();
const save = () => saveSettings(settings);
let items = [];

const canvas = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fatal').hidden = false;
  throw e;
}
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2, 4, 3);
const rim = new THREE.DirectionalLight(0xffffff, 1.0);
rim.position.set(-3, 2, -3);
scene.add(key, rim);

const stage = new THREE.Group(); // 自动旋转作用在它上面
scene.add(stage);
const quad = new QuadView(renderer, scene);

function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

// ---------- 内容列表 ----------

const isMedia = (it) => it.kind !== 'model';

function entries() {
  const list = BUILTINS.map((b) => ({ id: b.id, name: b.name }));
  if (items.filter(isMedia).length >= 2) list.push({ id: 'album', name: '旋转相册（全部照片和视频）' });
  for (const it of items) {
    list.push({ id: `item:${it.id}`, name: `${KIND_LABEL[it.kind]}：${it.name}`, removable: true });
  }
  return list;
}

function cfgOf(id) {
  return { on: true, secs: 20, ...settings.playlist[id] };
}

function build(id) {
  if (id === 'calib') return calib();
  if (id === 'album') return albumScene(items.filter(isMedia));
  if (id.startsWith('item:')) {
    const it = items.find((i) => `item:${i.id}` === id);
    if (!it) throw new Error('内容已被删除');
    return itemScene(it);
  }
  return (BUILTINS.find((b) => b.id === id) || BUILTINS[0]).make({ text: settings.text });
}

function disposeScene(s) {
  s.dispose?.();
  disposeObject(s.object);
}

// ---------- 切换与淡入淡出 ----------

let cur = null;
let token = 0;       // 每次切换加一，用来作废被后来的切换取代的异步流程
let shownToken = -1; // 已经实际显示出来的那次切换
let shownAt = 0;
let fadeTarget = 0; // 启动时从全黑淡入
let fadeWaiters = [];
let now = 0;

function fadeTo(v) {
  fadeTarget = v;
  return new Promise((resolve) => fadeWaiters.push(resolve));
}

async function show(id, remember = true) {
  const my = ++token;
  if (remember) {
    settings.current = id;
    save();
    ui.refresh();
  }
  let next;
  try {
    next = await build(id);
  } catch (e) {
    console.error(e);
    ui.toast(`无法显示：${e.message || e}`);
    if (my === token && id !== 'heart') show('heart');
    return;
  }
  if (my !== token) return disposeScene(next);
  await fadeTo(0);
  if (my !== token) return disposeScene(next);
  if (cur) {
    stage.remove(cur.object);
    disposeScene(cur);
  }
  cur = next;
  stage.rotation.y = 0;
  stage.add(cur.object);
  shownToken = my;
  shownAt = now;
  fadeTo(1);
}

function nextInLoop() {
  const list = entries().filter((e) => cfgOf(e.id).on);
  if (!list.length) return null;
  const i = list.findIndex((e) => e.id === settings.current);
  const next = list[(i + 1) % list.length].id;
  return next === settings.current ? null : next;
}

// ---------- 界面回调 ----------

let textTimer;
const app = {
  settings,
  entries,
  cfgOf,
  setCfg(id, patch) {
    settings.playlist[id] = { ...cfgOf(id), ...patch };
    save();
  },
  play(id) { show(id); },
  changed(key) {
    save();
    if (key === 'calib') show(settings.calib ? 'calib' : settings.current, false);
    if (key === 'text' && settings.current === 'text' && !settings.calib) {
      clearTimeout(textTimer);
      textTimer = setTimeout(() => show('text'), 400);
    }
  },
  async importFiles(files) {
    let last = null;
    let unsaved = false;
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) { ui.toast(`不支持的文件：${file.name}`); continue; }
      const draft = { kind, name: file.name.replace(/\.[^.]+$/, ''), blob: file };
      try {
        disposeScene(await itemScene(draft)); // 先试着载入一次，确认文件能用再保存
      } catch (e) {
        ui.toast(`${file.name}：${e.message || e}`);
        continue;
      }
      const it = await addItem(draft);
      unsaved ||= !it.persisted;
      items.push(it);
      last = it;
    }
    ui.refresh();
    if (last) show(`item:${last.id}`);
    if (unsaved) ui.toast('已导入，但无法保存到本机（隐私模式或空间不足），刷新后需要重新导入');
  },
  async remove(id) {
    const it = items.find((i) => `item:${i.id}` === id);
    if (!it) return;
    await deleteItem(it.id);
    items = items.filter((i) => i !== it);
    delete settings.playlist[id];
    save();
    const gone = !entries().some((e) => e.id === settings.current);
    if (gone) show('heart');
    else if (settings.current === 'album') show('album'); // 相册内容变了，重建
    else ui.refresh();
  },
};
const ui = initUI(app);

// ---------- 渲染循环 ----------

let last = performance.now();
function frame(time) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (time - last) / 1000);
  last = time;
  now += dt;

  const step = dt / FADE_SECONDS;
  const diff = fadeTarget - quad.fade;
  quad.fade = Math.abs(diff) <= step ? fadeTarget : quad.fade + Math.sign(diff) * step;
  if (quad.fade === fadeTarget && fadeWaiters.length) {
    const w = fadeWaiters;
    fadeWaiters = [];
    w.forEach((resolve) => resolve());
  }

  if (cur) {
    if (cur.spin !== false) stage.rotation.y += settings.spin * dt;
    cur.update(dt, now);
  }

  const idle = shownToken === token && quad.fade === 1;
  if (settings.loop && !settings.calib && idle && now - shownAt > cfgOf(settings.current).secs) {
    const next = nextInLoop();
    if (next) show(next);
    else shownAt = now;
  }

  quad.render(settings);
}

quad.fade = 0;
items = await listItems();
if (!entries().some((e) => e.id === settings.current)) settings.current = 'heart';
show(settings.current);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
