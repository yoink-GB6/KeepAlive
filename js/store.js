// 设置存 localStorage；导入的文件存 IndexedDB。两者都可能不可用（隐私模式等），失败时退回内存。

const KEY = 'holo.settings.v1';

export const defaults = {
  size: 0.3,
  dist: 0.62,
  brightness: 1,
  spin: 0.4,
  elevation: 0,
  flip: false,
  mirror: true,
  reverse: false,
  loop: true,
  muted: false,
  current: 'jellyfish',
  text: '✦ HELLO ✦',
  playlist: {}, // id -> { on, secs }
};

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* 用默认值 */ }
  return { ...defaults, ...saved, playlist: { ...(saved.playlist || {}) }, calib: false };
}

export function saveSettings(s) {
  const { calib, ...rest } = s; // 校准模式不保存，避免下次打开停在校准画面
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* 忽略 */ }
}

let dbPromise;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('holo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('items', mode);
    const req = fn(t.objectStore('items'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

const memory = [];
let memoryId = 1;

export async function listItems() {
  try { return await tx('readonly', (s) => s.getAll()); } catch { return memory.slice(); }
}

// 返回带 id 的条目；persisted 为 false 表示只存在内存里，刷新后会丢失
export async function addItem(item) {
  try {
    const id = await tx('readwrite', (s) => s.add(item));
    try { navigator.storage?.persist?.(); } catch { /* 忽略 */ }
    return { ...item, id, persisted: true };
  } catch {
    const it = { ...item, id: `m${memoryId++}`, persisted: false };
    memory.push(it);
    return it;
  }
}

export async function deleteItem(id) {
  const i = memory.findIndex((m) => m.id === id);
  if (i >= 0) { memory.splice(i, 1); return; }
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* 忽略 */ }
}
