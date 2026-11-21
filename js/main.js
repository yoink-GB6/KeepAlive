import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QuadView } from './quadview.js';
import { loadSettings, saveSettings, listItems, addItem, updateItem, deleteItem } from './store.js';
import { disposeObject } from './scenes/util.js';
import jellyfish from './scenes/jellyfish.js';
import fireworks from './scenes/fireworks.js';
import spiral from './scenes/spiral.js';
import galaxy from './scenes/galaxy.js';
import globe from './scenes/globe.js';
import textring from './scenes/textring.js';
import calib from './scenes/calib.js';
import { kindOf, itemScene, fileModelScene, albumScene, audioPlayer, pauseVideos } from './importers.js';
import { cutout } from './cutout.js';
import { initUI } from './ui.js';

// 随应用发布的模型，加一行就多一个。id 会存进设置里，定了就别改。
// 可选的微调（rotate、scale、hide、glow、color、gamma）见 importers.js 的 modelScene
const MODELS = [
  { id: 'model:butterfly', name: '蝴蝶', file: 'glbs/fantasy_butterfly_animation.glb', rotate: [-70, 0, 0], scale: 1.35, hide: /Tail|T1/, glow: 0.5 },
  { id: 'model:bangboo', name: '邦布', file: 'glbs/bangboo_01_-_eous.glb', scale: 1.15, hide: /stool/, gamma: 0.7 },
  { id: 'model:dolphin', name: '海豚', file: 'glbs/low_poly_dolphin.glb', rotate: [0, 90, 0], scale: 1.2 },
  { id: 'model:finger', name: '中指', file: 'glbs/test_middle_finger.glb', rotate: [0, 90, 0], scale: 1.13, color: 0xd9a27e },
];

const BUILTINS = [
  { id: 'jellyfish', name: '水母', make: jellyfish },
  { id: 'fireworks', name: '烟花', make: fireworks },
  { id: 'spiral', name: '旋涡星系', make: spiral },
  ...MODELS.map(({ id, name, ...model }) => ({ id, name, make: () => fileModelScene(model) })),
  { id: 'galaxy', name: '粒子星球', make: galaxy },
  { id: 'globe', name: '线框地球', make: globe },
  { id: 'text', name: '文字环', make: textring },
];
const FALLBACK = BUILTINS[0].id; // 当前内容不存在或载入失败时退回这里
const KIND_LABEL = { model: '模型', image: '照片', video: '视频' };
const FADE_SECONDS = 0.35;
const SLEEP_FADE_SECONDS = 2;

const settings = loadSettings();
const save = () => saveSettings(settings);
let items = [];   // 模型、照片、视频；背景音乐不在这里面
let music = null; // { item, player }，最多一首

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

// 进相册的内容。四分屏视频的画面是排好的四个方向，贴到相册的侧面上没法看，不算在内
const inAlbum = (it) => it.kind === 'image' || (it.kind === 'video' && !it.quad);

function entries() {
  const list = BUILTINS.map((b) => ({ id: b.id, name: b.name }));
  if (items.filter(inAlbum).length >= 2) list.push({ id: 'album', name: '旋转相册（全部照片和视频）' });
  for (const it of items) {
    const e = { id: `item:${it.id}`, name: `${KIND_LABEL[it.kind]}：${it.name}`, removable: true };
    if (it.cut) e.cut = !it.plain; // 抠过图的照片可以在抠图和原图之间切换
    if (it.kind === 'video') e.quad = !!it.quad; // 视频可以切换成四分屏（按原样显示）
    list.push(e);
  }
  return list;
}

function cfgOf(id) {
  return { on: true, secs: 20, ...settings.playlist[id] };
}

function build(id) {
  if (id === 'calib') return calib();
  if (id === 'album') return albumScene(items.filter(inAlbum));
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
let fade = 0;       // 切换内容时的淡入淡出；启动时从全黑淡入
let fadeTarget = 0;
let fadeWaiters = [];
let halted = false; // 息屏后渲染循环停着
let now = 0;
// 载入失败的内容（比如断网时还没缓存过的模型）。轮播跳过它们，不然每转一圈都要再失败、再提示一次；
// 手动点还是会重试，重新联网后也全部重试
const broken = new Set();
window.addEventListener('online', () => broken.clear());

function fadeTo(v) {
  fadeTarget = v;
  const done = new Promise((resolve) => fadeWaiters.push(resolve));
  if (halted) fadeDone(); // 没有帧来推进，直接到位：息屏期间切换的内容醒来时已经换好
  return done;
}

function fadeDone() {
  fade = fadeTarget;
  const w = fadeWaiters;
  fadeWaiters = [];
  w.forEach((resolve) => resolve());
}

async function show(id, remember = true, auto = false) {
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
    broken.add(id);
    // 轮播途中失败就接着播下一个，其余情况退回默认内容
    const next = (auto && nextInLoop()) || FALLBACK;
    if (my === token && id !== next) show(next, true, auto);
    return;
  }
  broken.delete(id);
  if (my !== token) return disposeScene(next);
  await fadeTo(0);
  if (my !== token) return disposeScene(next);
  if (cur) {
    stage.remove(cur.object);
    disposeScene(cur);
  }
  cur = next;
  quad.direct = cur.direct ?? null;
  applyAudio();
  stage.rotation.y = 0;
  stage.add(cur.object);
  shownToken = my;
  shownAt = now;
  fadeTo(1);
}

// 从当前内容往后找下一个参加轮播的，找一圈也没有就返回 null
function nextInLoop() {
  const all = entries();
  const i = all.findIndex((e) => e.id === settings.current);
  for (let k = 1; k <= all.length; k++) {
    const e = all[(i + k) % all.length];
    if (e.id === settings.current) break;
    if (cfgOf(e.id).on && !broken.has(e.id)) return e.id;
  }
  return null;
}

// ---------- 声音 ----------

// 浏览器在用户第一次操作之前不允许出声：视频一律先静音起播，等有过操作再放开
let gestured = false;
const canSound = () => (navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured);

// 所有"现在该不该响"的判断都在这里。切换内容、改静音、第一次操作、换音乐之后都调一次
function applyAudio() {
  const sound = canSound() && !settings.muted && !asleep;
  const v = cur?.video; // 只有单独播放的视频才有
  if (v) {
    v.muted = !sound;
    // 个别浏览器会在取消静音时把视频停掉，这种情况退回静音继续播
    if (v.paused && !asleep) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }
  const el = music?.player?.el;
  if (!el) return;
  if (sound && !v) el.play().catch(() => {}); // 视频自己出声时音乐让路
  else el.pause();
}

// ---------- 定时息屏 ----------

// 网页没法自己关屏幕。到点后画面淡到全黑、声音和视频暂停、渲染循环停下，再放开屏幕常亮，
// 剩下的交给系统自己的自动息屏。点一下、按任意键，或者解锁后回到页面，就醒过来
let asleep = false;     // 从开始变暗那一刻起就算
let dim = 1;            // 息屏的明暗，和切换内容的淡入淡出相乘
let sleepAt = Infinity; // 到期时刻（Date.now()）

// 重新倒计时。开始播放、有操作、改了设置、醒来之后都调一次
function armSleep() {
  sleepAt = settings.sleep > 0 ? Date.now() + settings.sleep * 60000 : Infinity;
}

// 每秒对一次表，而不是定一个到点才响的长定时器：后台标签页的定时器会被拖慢，
// 设备睡着时干脆不走，只有墙上时钟的到期时刻是准的
setInterval(() => {
  if (asleep) return;
  if (ui.busy()) armSleep(); // 设置面板或校准向导开着、正在导入时不息屏，等忙完从头再计
  else if (Date.now() >= sleepAt) sleep();
}, 1000);

function sleep() {
  asleep = true;
  pauseVideos(true);
  applyAudio();
  ui.sleeping(true);
}

function wake() {
  asleep = false;
  pauseVideos(false);
  applyAudio();
  ui.sleeping(false);
  armSleep();
  shownAt = now; // 轮播从头数这一项的秒数，不然刚醒就切走
  if (halted) {
    halted = false;
    requestAnimationFrame(frame);
  }
}

for (const type of ['click', 'keydown']) {
  window.addEventListener(type, (e) => {
    gestured = true;
    if (asleep) {
      e.stopPropagation(); // 唤醒的这一下到此为止，不然会顺手把设置面板点开
      wake();
    } else {
      armSleep();
      applyAudio();
    }
  }, true);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (asleep) wake(); // 息屏后设备锁了屏，用户解锁回来
  else armSleep();
});

async function setMusic(item, player) {
  const old = music;
  music = { item, player };
  if (old) {
    old.player?.dispose();
    await deleteItem(old.item.id);
  }
  applyAudio();
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
    if (key === 'muted') applyAudio();
    if (key === 'sleep') armSleep();
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
      if (kind === 'audio') { // 背景音乐只留一首，新的顶掉旧的
        try {
          const player = await audioPlayer(file);
          const it = await addItem(draft);
          unsaved ||= !it.persisted;
          await setMusic(it, player);
          ui.toast(`已设为背景音乐：${draft.name}`);
        } catch (e) {
          ui.toast(`${file.name}：${e.message || e}`);
        }
        continue;
      }
      try {
        disposeScene(await itemScene(draft)); // 先试着载入一次，确认文件能用再保存
      } catch (e) {
        ui.toast(`${file.name}：${e.message || e}`);
        continue;
      }
      if (kind === 'image' && settings.cutout) {
        // 原图照样保存，抠好的图另存一份；抠不成就只有原图，导入不受影响
        try {
          draft.cut = await cutout(file, (stage) => {
            ui.progress(stage === 'load' ? '正在准备抠图（第一次要载入模型，请稍等）…' : `正在抠图：${draft.name}…`);
          });
        } catch (e) {
          ui.toast(`${file.name}：抠图没成功（${e.message || e}），已按原图导入`);
        }
        ui.progress(null);
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
  music: () => music?.item.name ?? null,
  async removeMusic() {
    if (!music) return;
    const old = music;
    music = null;
    old.player?.dispose();
    await deleteItem(old.item.id);
    ui.refresh();
  },
  async toggleCut(id) {
    const it = items.find((i) => `item:${i.id}` === id);
    if (!it?.cut) return;
    it.plain = !it.plain;
    await updateItem(it);
    relist(id, 'album');
  },
  async toggleQuad(id) {
    const it = items.find((i) => `item:${i.id}` === id);
    if (it?.kind !== 'video') return;
    it.quad = !it.quad;
    await updateItem(it);
    relist(id, 'album'); // 它进出相册，相册也跟着变
  },
  async remove(id) {
    const it = items.find((i) => `item:${i.id}` === id);
    if (!it) return;
    await deleteItem(it.id);
    items = items.filter((i) => i !== it);
    delete settings.playlist[id];
    save();
    relist('album'); // 相册内容变了
  },
};

// 导入的内容删了或改了之后调。rebuild 是画面受影响的条目：正在显示的是其中之一就重建；
// 正在显示的已经不在列表里（被删了，或者相册凑不够两项了）就退回默认内容。
// 校准画面开着时不打断它，退出校准时自然会重建
function relist(...rebuild) {
  if (!entries().some((e) => e.id === settings.current)) {
    settings.current = FALLBACK;
    rebuild.push(FALLBACK);
    save();
  }
  if (!settings.calib && rebuild.includes(settings.current)) show(settings.current);
  else ui.refresh();
}
const ui = initUI(app);

// ---------- 渲染循环 ----------

let last = performance.now();
const approach = (v, target, step) => (Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step);

function frame(time) {
  const raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (time - last) / 1000);
  last = time;
  now += dt;

  fade = approach(fade, fadeTarget, dt / FADE_SECONDS);
  if (fade === fadeTarget && fadeWaiters.length) fadeDone();
  dim = approach(dim, asleep ? 0 : 1, dt / (asleep ? SLEEP_FADE_SECONDS : FADE_SECONDS));
  quad.fade = fade * dim;

  if (cur) {
    if (cur.spin !== false) stage.rotation.y += settings.spin * dt;
    cur.update(dt, now);
  }

  // 息屏期间不轮播
  const idle = shownToken === token && fade === 1 && !asleep;
  if (settings.loop && !settings.calib && idle && now - shownAt > cfgOf(settings.current).secs) {
    const next = nextInLoop();
    if (next) show(next, true, true);
    else shownAt = now;
  }

  quad.render(settings);

  // 已经全黑：上面这一帧把黑画面交了出去，之后不再排帧，显卡歇着
  if (asleep && dim === 0) {
    cancelAnimationFrame(raf);
    halted = true;
    fadeDone(); // 切换到一半的别卡在那里等
  }
}

quad.fade = 0;
const stored = await listItems();
items = stored.filter((it) => it.kind !== 'audio');
// 音乐在后台载入，不拖慢首屏；载入失败也留着名字，方便用户删掉
for (const it of stored.filter((s) => s.kind === 'audio')) {
  await setMusic(it, null);
}
if (music) {
  const mine = music;
  audioPlayer(mine.item.blob).then((player) => {
    if (music !== mine) return player.dispose();
    mine.player = player;
    applyAudio();
  }, () => {});
}
if (!entries().some((e) => e.id === settings.current)) settings.current = FALLBACK;
show(settings.current);
requestAnimationFrame(frame);
armSleep();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
