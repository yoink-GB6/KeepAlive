const $ = (id) => document.getElementById(id);

const SLIDERS = {
  size: (v) => `${Math.round(v * 100)}%`,
  dist: (v) => `${Math.round(v * 100)}%`,
  brightness: (v) => `${Math.round(v * 100)}%`,
  spin: (v) => (v === 0 ? '停' : `${(v * 9.55).toFixed(1)} 圈/分`),
  elevation: (v) => `${v}°`,
};
const CHECKS = ['flip', 'mirror', 'reverse', 'calib', 'loop', 'muted', 'cutout'];
const WIZARD_SLIDERS = { size: 'wizSize', dist: 'wizDist' }; // 向导里重复出现的滑块

// 向导的前三步各对应一个开关：答"不对"就切换它，然后原地再问一遍，让用户用眼睛确认
const WIZARD_STEPS = [
  { key: 'flip', ok: '正立', fix: '倒立', text: '把棱锥放在屏幕正中。从屏幕下边缘这一侧（这行字正着读时靠近你的那一边）平视棱锥，"前"字是正立的还是倒立的？' },
  { key: 'mirror', ok: '正常', fix: '反了', text: '"前"字是正常的字，还是左右反了的镜像字？' },
  { key: 'reverse', ok: '右', fix: '左', text: '绕到屏幕右边那一侧看棱锥，看到的是哪个字？' },
  { ok: '完成', text: '拖动滑块，让四个影像都完整地落在棱锥面的中间，不被切掉。' },
];

export function initUI(app) {
  const { settings } = app;
  const panel = $('panel');
  const list = $('list');
  const hint = $('hint');
  const toastEl = $('toast');

  // 同一个设置可能有两个滑块（面板里和向导里），改一个另一个跟着动
  for (const [key, format] of Object.entries(SLIDERS)) {
    const ids = [key, WIZARD_SLIDERS[key]].filter(Boolean);
    const sync = () => {
      for (const id of ids) {
        $(id).value = settings[key];
        $(`${id}Out`).textContent = format(settings[key]);
      }
    };
    sync();
    for (const id of ids) {
      $(id).addEventListener('input', () => {
        settings[key] = Number($(id).value);
        sync();
        app.changed(key);
      });
    }
  }

  const setCheck = (key, value) => {
    settings[key] = value;
    $(key).checked = value;
    app.changed(key);
  };
  for (const key of CHECKS) {
    const input = $(key);
    input.checked = !!settings[key];
    input.addEventListener('change', () => setCheck(key, input.checked));
  }

  const sleep = $('sleep');
  sleep.value = settings.sleep;
  sleep.addEventListener('change', () => {
    settings.sleep = Number(sleep.value);
    app.changed('sleep');
  });

  const text = $('text');
  text.value = settings.text;
  text.addEventListener('input', () => {
    settings.text = text.value;
    app.changed('text');
  });

  let hintTimer;
  const hideHint = () => {
    clearTimeout(hintTimer);
    hint.hidden = true;
  };

  // 点画面开关设置面板
  const setOpen = (open) => {
    panel.hidden = !open;
    hideHint();
  };
  $('stage').addEventListener('click', () => {
    if (wizard.hidden) setOpen(panel.hidden); // 向导进行中点画面不弹出面板
  });
  $('closeBtn').addEventListener('click', () => setOpen(false));
  hintTimer = setTimeout(hideHint, 5000);

  // 校准向导
  const wizard = $('wizard');
  let wizardStep = 0;
  const showStep = (i, adjusted = false) => {
    wizardStep = i;
    const s = WIZARD_STEPS[i];
    $('wizStep').textContent = `校准 ${i + 1} / ${WIZARD_STEPS.length}`;
    $('wizText').textContent = (adjusted ? '已调整，再看一眼。' : '') + s.text;
    $('wizSliders').hidden = !!s.key;
    $('wizOk').textContent = s.ok;
    $('wizOk').classList.toggle('primary', !s.key);
    $('wizFix').hidden = !s.key;
    $('wizFix').textContent = s.fix || '';
  };
  const closeWizard = () => {
    wizard.hidden = true;
    if (settings.calib) setCheck('calib', false); // 回到原来播放的内容
  };
  $('wizardBtn').addEventListener('click', () => {
    setOpen(false);
    if (!settings.calib) setCheck('calib', true);
    showStep(0);
    wizard.hidden = false;
  });
  $('wizOk').addEventListener('click', () => {
    if (wizardStep < WIZARD_STEPS.length - 1) return showStep(wizardStep + 1);
    closeWizard();
    toast('校准完成，设置已保存');
  });
  $('wizFix').addEventListener('click', () => {
    const { key } = WIZARD_STEPS[wizardStep];
    setCheck(key, !settings[key]);
    showStep(wizardStep, true);
  });
  $('wizQuit').addEventListener('click', closeWizard);

  $('musicDel').addEventListener('click', () => {
    if (confirm('删除背景音乐？')) app.removeMusic();
  });

  const file = $('file');
  let importing = 0;
  $('importBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const files = [...file.files];
    file.value = '';
    if (!files.length) return;
    importing++;
    try { await app.importFiles(files); } finally { importing--; }
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

  // 防止息屏。必须在用户操作之后申请，切回页面时要重新申请。
  // 定时息屏之后反过来：把锁放开，醒来之前谁也别再申请
  let wakeLock = null;
  let wantAwake = true;
  let locking = false;
  const keepAwake = async () => {
    if (!wantAwake || locking || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    locking = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      if (wantAwake) wakeLock = lock;
      else lock.release().catch(() => {}); // 申请到手之前已经息屏了
    } catch { /* 电量低等情况下会被拒绝 */ }
    locking = false;
  };
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', keepAwake);

  // 定时息屏开始 / 结束。提示只露几秒：全黑的屏幕上长时间留字会烧屏
  function sleeping(on) {
    wantAwake = !on;
    if (on) wakeLock?.release().catch(() => {});
    else keepAwake();
    hideHint();
    hint.textContent = '点一下屏幕唤醒';
    hint.classList.toggle('faint', on);
    hint.hidden = !on;
    if (on) hintTimer = setTimeout(hideHint, 5000);
  }

  // 短时间内的多条提示叠在一起显示，不互相覆盖。
  // 进度提示（抠图要好几秒）排在最下面一行，不会自己消失，由调用方清掉
  let toastTimer;
  let toastLines = [];
  let progressLine = '';
  const renderToast = () => {
    const lines = toastLines.slice(-4);
    if (progressLine) lines.push(progressLine);
    toastEl.textContent = lines.join('\n');
    toastEl.hidden = !lines.length;
  };
  function toast(message) {
    toastLines.push(message);
    renderToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastLines = [];
      renderToast();
    }, 4500);
  }
  function progress(message) {
    progressLine = message || '';
    renderToast();
  }

  function refresh() {
    const music = app.music();
    $('musicName').textContent = `背景音乐：${music ?? '未导入'}`;
    $('musicDel').hidden = music === null;

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
      // 条目自己的小开关，放在名称和秒数之间，各行的秒数才对得齐
      const toggle = (className, label, pressed, title, aria, onClick) => {
        const b = document.createElement('button');
        b.className = className;
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-pressed', pressed);
        b.setAttribute('aria-label', aria);
        b.addEventListener('click', onClick);
        secs.before(b);
      };
      if (e.cut !== undefined) {
        toggle('cut', '抠图', e.cut, '在抠图和原图之间切换', `"${e.name}"抠掉背景`, () => app.toggleCut(e.id));
      }
      if (e.quad !== undefined) {
        toggle('quad', '四分屏', e.quad, '视频里已经排好四个方向的画面时打开，按原样显示', `"${e.name}"按四分屏视频原样显示`, () => app.toggleQuad(e.id));
      }
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

  // 设置面板或校准向导开着、正在导入：用户还在操作，这时候不该息屏
  const busy = () => !panel.hidden || !wizard.hidden || importing > 0;

  return { refresh, toast, progress, busy, sleeping };
}
