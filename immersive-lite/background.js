// 后台:代理翻译请求(绕开页面 CSP)+ 工具栏图标点击切换悬浮按钮显隐。
// 接口与请求格式提取自 immersive-translate 官方构建产物中的 Google 免费服务:
// POST https://translate.googleapis.com/translate_a/t?client=gtx&dt=t&sl=auto&tl=zh-CN
// 多段文本以重复 q 参数提交,返回 [[译文, 检测语言], ...]。

const API = 'https://translate.googleapis.com/translate_a/t';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'immv-translate' || !Array.isArray(msg.texts) || msg.texts.length === 0) return;

  const params = new URLSearchParams({
    client: 'gtx',
    dt: 't',
    sl: msg.sl || 'auto',
    tl: msg.tl || 'zh-CN',
  });
  const body = new URLSearchParams();
  for (const t of msg.texts) body.append('q', t);

  fetch(`${API}?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
    .then(async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error('BAD_RESPONSE');
      sendResponse({ ok: true, data });
    })
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

  return true; // 异步响应
});

// 工具栏图标点击:取反悬浮按钮显隐状态,广播到所有标签页
chrome.action.onClicked.addListener(async () => {
  const { fabHidden } = await chrome.storage.local.get('fabHidden');
  const next = !fabHidden;
  await chrome.storage.local.set({ fabHidden: next });
  chrome.action.setBadgeText({ text: next ? 'off' : '' });
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    // 未注入 content script 的页面(chrome:// 等)会 reject,直接忽略
    chrome.tabs.sendMessage(t.id, { type: 'immv-toggle-fab', hidden: next }).catch(() => {});
  }
});

// SW 被杀后重新唤醒时恢复角标(badge 不跨 SW 生命周期持久)
chrome.storage.local.get('fabHidden').then(({ fabHidden }) => {
  if (fabHidden) chrome.action.setBadgeText({ text: 'off' });
});
