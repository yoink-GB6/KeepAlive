const $ = (id) => document.getElementById(id);

const SLIDERS = {
  size: (v) => `${Math.round(v * 100)}%`,
  dist: (v) => `${Math.round(v * 100)}%`,
  brightness: (v) => `${Math.round(v * 100)}%`,
  spin: (v) => (v === 0 ? '停' : `${(v * 9.55).toFixed(1)} 圈/分`),
  elevation: (v) => `${v}°`,
};
const CHECKS = ['flip', 'mirror', 'reverse', 'calib', 'loop'];

export function initUI(app) {
  const { settings } = app;
  const panel = $('panel');
  const list = $('list');
  const hint = $('hint');
  const toastEl = $('toast');

  for (const [key, format] of Object.entries(SLIDERS)) {
    const input = $(key);
    const out = $(`${key}Out`);
    input.value = settings[key];
    out.textContent = format(Number(input.value));
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      out.textContent = format(settings[key]);
      app.changed(key);
    });
  }

  for (const key of CHECKS) {
    const input = $(key);
    input.checked = !!settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      app.changed(key);
    });
  }

  const text = $('text');
  text.value = settings.text;
  text.addEventListener('input', () => {
    settings.text = text.value;
    app.changed('text');
  });

  // 点画面开关设置面板
  const setOpen = (open) => {
    panel.hidden = !open;
    hint.hidden = true;
  };
  $('stage').addEventListener('click', () => setOpen(panel.hidden));
  $('closeBtn').addEventListener('click', () => setOpen(false));
  setTimeout(() => { hint.hidden = true; }, 5000);

  const file = $('file');
  $('importBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const files = [...file.files];
    file.value = '';
    if (files.length) await app.importFiles(files);
  });

  // 全屏。iPhone 的 Safari 不支持，只能"添加到主屏幕"
  const root = document.documentElement;
  const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
    || navigator.standalone === true;
  $('fullscreenBtn').hidden = !canFullscreen || standalone;
  $('iosTip').hidden = canFullscreen || standalone;
  $('fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      p?.catch?.(() => {});
    }
  });

  // 防止息屏。必须在用户操作之后申请，切回页面时要重新申请
  let wakeLock = null;
  const keepAwake = async () => {
    if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* 电量低等情况下会被拒绝 */ }
  };
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', keepAwake);

  // 短时间内的多条提示叠在一起显示，不互相覆盖
  let toastTimer;
  let toastLines = [];
  function toast(message) {
    toastLines.push(message);
    toastEl.textContent = toastLines.slice(-4).join('\n');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastLines = [];
    }, 4500);
  }

  function refresh() {
    list.textContent = '';
    for (const e of app.entries()) {
      const cfg = app.cfgOf(e.id);
      const li = document.createElement('li');
      if (e.id === settings.current) li.className = 'current';

      const on = document.createElement('input');
      on.type = 'checkbox';
      on.checked = cfg.on;
      on.title = '加入轮播';
      on.setAttribute('aria-label', `把"${e.name}"加入轮播`);
      on.addEventListener('change', () => app.setCfg(e.id, { on: on.checked }));

      const name = document.createElement('button');
      name.className = 'name';
      name.textContent = e.name;
      name.addEventListener('click', () => app.play(e.id));

      const secs = document.createElement('input');
      secs.type = 'number';
      secs.min = 3;
      secs.max = 3600;
      secs.value = cfg.secs;
      secs.setAttribute('aria-label', `"${e.name}"的轮播时长（秒）`);
      secs.addEventListener('change', () => {
        const v = Math.max(3, Math.min(3600, Math.round(Number(secs.value)) || 20));
        secs.value = v;
        app.setCfg(e.id, { secs: v });
      });
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = '秒';

      li.append(on, name, secs, unit);
      if (e.removable) {
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '✕';
        del.setAttribute('aria-label', `删除"${e.name}"`);
        del.addEventListener('click', () => {
          if (confirm(`删除"${e.name}"？`)) app.remove(e.id);
        });
        li.append(del);
      }
      list.append(li);
    }
  }

  return { refresh, toast };
}
