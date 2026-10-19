// 极简沉浸式翻译:悬浮按钮 + 整页双语翻译。
// 目标语言固定 zh-CN,无任何配置项。再次点击按钮还原页面。
(() => {
  'use strict';
  if (window.__immvLoaded) return;
  window.__immvLoaded = true;

  // ---------------- 常量 ----------------
  const TARGET = 'zh-CN';
  const MAX_SEG_CHARS = 3800; // 单段超长时按句子边界拆分
  const MAX_Q_COUNT = 16;     // 单请求最大段数
  const MAX_Q_CHARS = 3200;   // 单请求最大文本总量
  const CONCURRENCY = 3;      // 并发请求数(官方默认限速约 10 次/1.05s,此处保守)

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'BUTTON', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SVG', 'MATH', 'CANVAS',
    'IFRAME', 'VIDEO', 'AUDIO', 'PICTURE', 'MAP', 'OBJECT', 'EMBED',
    'TEMPLATE', 'DIALOG', 'META', 'LINK', 'HEAD',
  ]);
  // 只向下递归、自身永不作为翻译段落的纯容器标签
  const PURE_CONTAINERS = new Set([
    'HTML', 'BODY', 'UL', 'OL', 'TABLE', 'TR', 'THEAD', 'TBODY', 'TFOOT',
    'FORM', 'FIELDSET', 'DETAILS', 'MAIN', 'NAV', 'HEADER', 'FOOTER',
    'SECTION', 'ARTICLE', 'ASIDE',
  ]);
  const BLOCK_TAGS = new Set([
    ...PURE_CONTAINERS,
    'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
    'DD', 'DT', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'TD', 'TH',
  ]);
  // 译文插到元素内部(父标签受 HTML 结构约束,不能在后面插兄弟节点)
  const INSERT_INSIDE = new Set(['LI', 'TD', 'TH', 'DD', 'DT']);
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/; // 仅汉字;假名/谚文视为待翻译外文
  const LETTER_RE = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7a3]/;

  // ---------------- 状态 ----------------
  let state = 'idle'; // idle | busy | done
  let session = 0;    // 会话号,还原后使在途回调失效

  // ---------------- 悬浮按钮(Shadow DOM 隔离样式) ----------------
  const host = document.createElement('div');
  host.setAttribute('data-immv-root', '1');
  // 注意:内联样式不能写 all:initial(会重置 position),样式隔离由 :host 规则负责
  host.style.cssText =
    'position:fixed;top:55%;right:10px;z-index:2147483647;width:44px;height:44px';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .btn {
        width: 44px; height: 44px; border-radius: 50%;
        background: linear-gradient(135deg, #5b6cff, #405ceb);
        color: #fff; font: 600 19px/44px system-ui, sans-serif;
        text-align: center; cursor: grab; user-select: none;
        touch-action: none;
        box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .45), 0 2px 10px rgba(0, 0, 0, .35);
        transition: transform .15s, background .15s, opacity .15s;
        opacity: .92; position: relative;
      }
      .btn:hover { opacity: 1; transform: scale(1.08); }
      .btn.dragging { cursor: grabbing; transition: none; transform: none; }
      .btn.done {
        background: linear-gradient(135deg, #21a179, #178a64);
      }
      .btn.done:hover { opacity: 1; }
      .btn.error { background: linear-gradient(135deg, #d64545, #b93232); }
      .ring {
        display: none; position: absolute; inset: 12px;
        border: 2.5px solid rgba(255, 255, 255, .35);
        border-top-color: #fff; border-radius: 50%;
        animation: immv-spin .8s linear infinite;
      }
      .btn.busy .glyph { display: none; }
      .btn.busy .ring { display: block; }
      @keyframes immv-spin { to { transform: rotate(360deg); } }
      .toast {
        position: absolute; right: 52px; top: 4px; white-space: nowrap;
        background: rgba(23, 30, 46, .92); color: #fff;
        font: 13px/1.5 system-ui, sans-serif; padding: 6px 12px;
        border-radius: 8px; opacity: 0; pointer-events: none;
        transition: opacity .25s;
      }
      .toast.show { opacity: 1; }
    </style>
    <div class="btn" title="翻译 / 还原本页"><span class="glyph">译</span><div class="ring"></div></div>
    <div class="toast"></div>
  `;
  const btn = shadow.querySelector('.btn');
  const toastEl = shadow.querySelector('.toast');

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function setBtn(next) {
    state = next;
    btn.classList.toggle('busy', next === 'busy');
    btn.classList.toggle('done', next === 'done');
    btn.classList.remove('error');
  }

  function onToggle() {
    if (state === 'busy') { toast('正在翻译中…'); return; }
    if (state === 'done') { revert(); return; }
    start();
  }

  // ---------------- 拖拽(移动 ≥5px 视为拖拽,否则视为点击) ----------------
  const DRAG_THRESHOLD = 5;
  const EDGE_GAP = 4;
  let drag = null;

  function clampPos(x, y) {
    const w = host.offsetWidth, h = host.offsetHeight;
    return [
      Math.min(Math.max(x, EDGE_GAP), window.innerWidth - w - EDGE_GAP),
      Math.min(Math.max(y, EDGE_GAP), window.innerHeight - h - EDGE_GAP),
    ];
  }

  // toast 显示在按钮靠屏幕中心的一侧,避免拖到边缘后被裁剪
  function positionToast(x) {
    const onLeftHalf = x < window.innerWidth / 2;
    toastEl.style.right = onLeftHalf ? 'auto' : '52px';
    toastEl.style.left = onLeftHalf ? '52px' : 'auto';
  }

  function setPos(x, y) {
    const [cx, cy] = clampPos(x, y);
    host.style.left = cx + 'px';
    host.style.top = cy + 'px';
    host.style.right = 'auto';
    positionToast(cx);
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = host.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top, moved: false };
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('dragging');
  });
  btn.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setPos(drag.origLeft + dx, drag.origTop + dy);
  });
  btn.addEventListener('pointerup', () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    btn.classList.remove('dragging');
    if (moved) {
      chrome.storage?.local?.set({
        btnPos: { x: parseFloat(host.style.left), y: parseFloat(host.style.top) },
      });
      return; // 拖拽结束不触发翻译
    }
    onToggle();
  });
  btn.addEventListener('pointercancel', () => {
    drag = null;
    btn.classList.remove('dragging');
  });

  // ---------------- 悬浮按钮显隐(工具栏图标切换,background 广播) ----------------
  function applyFab(hidden) {
    if (hidden) { host.style.display = 'none'; return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = '';
  }
  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.type === 'immv-toggle-fab') applyFab(!!msg.hidden);
    });
  } catch { /* 上下文失效时忽略 */ }

  function mount() {
    document.documentElement.appendChild(host);
    // 恢复显隐状态与上次拖拽位置(storage 不可用时默认显示在默认位置)
    try {
      chrome.storage?.local?.get(['fabHidden', 'btnPos'], ({ fabHidden, btnPos } = {}) => {
        if (!host.isConnected) return;
        if (fabHidden) host.style.display = 'none';
        if (btnPos) setPos(btnPos.x, btnPos.y);
      });
    } catch { /* 停在默认状态 */ }
  }
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });

  // ---------------- 文本判定 ----------------
  function textStats(s) {
    let cjk = 0, letter = 0;
    for (const ch of s) {
      if (CJK_RE.test(ch)) cjk++;
      else if (LETTER_RE.test(ch)) letter++;
    }
    return { cjk, letter };
  }

  function visible(el) {
    try {
      return el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : true;
    } catch { return true; }
  }

  // 段落是否值得翻译:有字母、非纯符号/数字/URL、中文占比不过高
  function translatable(text) {
    const s = text.trim();
    if (s.length < 2 || s.length > 8000) return false;
    if (/^(https?:\/\/|www\.)\S+$/i.test(s)) return false;
    const { cjk, letter } = textStats(s);
    if (letter + cjk < 2) return false;            // 纯数字/标点
    if (cjk / (letter + cjk) > 0.6) return false; // 基本已是中文(letter=0 时比例恒为 1)
    return true;
  }

  // ---------------- DOM 分段遍历 ----------------
  function isBlock(el) { return BLOCK_TAGS.has(el.tagName); }

  function collectSegments(root) {
    const segs = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (child.closest('[data-immv-root],[data-immv-id],[contenteditable=""],[contenteditable="true"]')) continue;
        if (!isBlock(child)) { walk(child); continue; }
        if (PURE_CONTAINERS.has(child.tagName) || child.querySelector([...BLOCK_TAGS].join(','))) {
          walk(child);
          continue;
        }
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || !visible(child) || !translatable(text)) { walk(child); continue; }
        child.setAttribute('data-immv-id', '1');
        segs.push({ el: child, text });
      }
    };
    walk(root);
    return segs;
  }

  // 超长段落按句子边界拆成多段(译文最终合并回一条)
  function splitLong(text) {
    if (text.length <= MAX_SEG_CHARS) return [text];
    const parts = [];
    const sentences = text.split(/(?<=[.!?。!?;;])/);
    let buf = '';
    for (const s of sentences) {
      if (buf.length + s.length > MAX_SEG_CHARS && buf) { parts.push(buf); buf = ''; }
      buf += s;
    }
    if (buf) parts.push(buf);
    return parts;
  }

  // ---------------- 翻译调度 ----------------
  function translateBatch(texts) {
    return chrome.runtime.sendMessage({ type: 'immv-translate', texts, tl: TARGET }).then((res) => {
      if (!res) throw new Error('NO_RESPONSE');
      if (!res.ok) throw new Error(res.error || 'FAILED');
      // 官方解析逻辑:每项可能是 [译文, 源语言] 或纯字符串
      return res.data.map((u) => (Array.isArray(u) ? u[0] : u));
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function translateWithRetry(texts, mySession, attempt = 0) {
    try {
      return await translateBatch(texts);
    } catch (e) {
      if (mySession !== session) return null;
      if (attempt < 2 && /HTTP (4|5)\d\d|NETWORK|Failed to fetch|NetworkError|NO_RESPONSE/i.test(String(e.message))) {
        await sleep(1200 * (attempt + 1));
        return translateWithRetry(texts, mySession, attempt + 1);
      }
      throw e;
    }
  }

  // 把段落切成请求批次;渲染单段,完成时按归属元素合并渲染
  function buildJobs(segs) {
    const items = []; // { owner, text }
    for (const seg of segs) {
      for (const part of splitLong(seg.text)) items.push({ owner: seg, text: part });
    }
    const jobs = [];
    let cur = [], curChars = 0;
    for (const it of items) {
      if (cur.length >= MAX_Q_COUNT || curChars + it.text.length > MAX_Q_CHARS) {
        if (cur.length) jobs.push(cur);
        cur = []; curChars = 0;
      }
      cur.push(it); curChars += it.text.length;
    }
    if (cur.length) jobs.push(cur);
    return jobs;
  }

  function renderTranslation(seg, text) {
    // 端点偶发返回 HTML 实体转义,一次性解码(等效官方的实体替换链)
    const dec = document.createElement('textarea');
    dec.innerHTML = text;
    const div = document.createElement('div');
    div.className = 'immv-trans';
    div.setAttribute('data-immv-trans', '1');
    div.textContent = dec.value;
    if (INSERT_INSIDE.has(seg.el.tagName)) seg.el.appendChild(div);
    else seg.el.insertAdjacentElement('afterend', div);
  }

  async function runJobs(jobs, segs, mySession) {
    let idx = 0, failed = false;
    const worker = async () => {
      while (idx < jobs.length && mySession === session) {
        const job = jobs[idx++];
        try {
          const out = await translateWithRetry(job.map((j) => j.text), mySession);
          if (mySession !== session) return;
          job.forEach((it, i) => {
            const t = (out?.[i] || '').trim();
            if (t && t !== it.text) {
              it.owner.translated = (it.owner.translated || '') + t;
            }
          });
        } catch (e) {
          failed = true;
          console.warn('[immersive-lite] 批次翻译失败:', e.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    // 全部批次完成后按元素渲染(超长段落的多段译文已在 owner 上合并)
    if (mySession === session) {
      for (const seg of segs) {
        if (seg.translated) renderTranslation(seg, seg.translated);
        delete seg.translated;
      }
    }
    return failed;
  }

  // ---------------- 主流程 ----------------
  async function start() {
    const mySession = ++session;
    const segs = collectSegments(document.body);
    if (segs.length === 0) { toast('未发现可翻译的外文内容'); return; }

    setBtn('busy');
    const failed = await runJobs(buildJobs(segs), segs, mySession);
    if (mySession !== session) return; // 期间被还原
    setBtn('done');
    if (failed) toast('部分内容翻译失败,已跳过');
  }

  function revert() {
    session++; // 使在途请求回调失效
    document.querySelectorAll('[data-immv-trans]').forEach((n) => n.remove());
    document.querySelectorAll('[data-immv-id]').forEach((el) => el.removeAttribute('data-immv-id'));
    setBtn('idle');
  }
})();
