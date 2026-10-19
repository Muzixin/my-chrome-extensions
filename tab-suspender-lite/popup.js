const {
  DEFAULT_DELAY_MINUTES,
  normalizeDelayMinutes,
  normalizeDomain,
} = globalThis.TabSuspenderLite;

const delayForm = document.querySelector('#delay-form');
const delayInput = document.querySelector('#delay');
const domainForm = document.querySelector('#domain-form');
const domainInput = document.querySelector('#domain');
const addCurrentButton = document.querySelector('#add-current');
const whitelistElement = document.querySelector('#whitelist');
const emptyElement = document.querySelector('#empty');
const statusElement = document.querySelector('#status');

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function renderWhitelist(whitelist) {
  whitelistElement.replaceChildren();
  emptyElement.hidden = whitelist.length > 0;

  for (const domain of [...whitelist].sort((a, b) => a.localeCompare(b))) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    const removeButton = document.createElement('button');

    name.textContent = domain;
    name.title = domain;
    removeButton.type = 'button';
    removeButton.textContent = '删除';
    removeButton.dataset.domain = domain;
    removeButton.setAttribute('aria-label', `删除 ${domain}`);

    item.append(name, removeButton);
    whitelistElement.append(item);
  }
}

async function getWhitelist() {
  const settings = await chrome.storage.local.get({ whitelist: [] });
  return Array.isArray(settings.whitelist) ? settings.whitelist : [];
}

function withWhitelistLock(callback) {
  return navigator.locks.request('tab-suspender-lite-whitelist', callback);
}

async function loadSettings() {
  const settings = await chrome.storage.local.get({
    delayMinutes: DEFAULT_DELAY_MINUTES,
    whitelist: [],
  });
  delayInput.value = normalizeDelayMinutes(settings.delayMinutes);
  renderWhitelist(Array.isArray(settings.whitelist) ? settings.whitelist : []);
}

async function saveDelay(event) {
  event.preventDefault();
  if (!delayInput.value || !Number.isFinite(Number(delayInput.value))) {
    setStatus('请输入有效的休眠时间', true);
    return;
  }

  const delayMinutes = normalizeDelayMinutes(delayInput.value);
  await chrome.storage.local.set({ delayMinutes });
  delayInput.value = delayMinutes;
  setStatus(`休眠时间已设为 ${delayMinutes} 分钟`);
}

async function addDomain(value) {
  const domain = normalizeDomain(value);
  if (!domain) {
    setStatus('请输入有效的域名或 HTTP(S) 网址', true);
    return false;
  }

  return withWhitelistLock(async () => {
    const whitelist = await getWhitelist();
    if (whitelist.includes(domain)) {
      setStatus(`${domain} 已在白名单中`);
      return true;
    }

    whitelist.push(domain);
    await chrome.storage.local.set({ whitelist });
    renderWhitelist(whitelist);
    setStatus(`已加入 ${domain} 及其子域名`);
    return true;
  });
}

async function addCurrentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !normalizeDomain(tab.url)) {
    setStatus('当前页面不支持加入白名单', true);
    return;
  }
  await addDomain(tab.url);
}

async function removeDomain(domain) {
  await withWhitelistLock(async () => {
    const whitelist = await getWhitelist();
    const updated = whitelist.filter((rule) => rule !== domain);
    await chrome.storage.local.set({ whitelist: updated });
    renderWhitelist(updated);
    setStatus(`已移除 ${domain}`);
  });
}

function handleError(error) {
  console.error('[Tab Suspender Lite]', error);
  setStatus('操作失败，请重试', true);
}

delayForm.addEventListener('submit', (event) => {
  void saveDelay(event).catch(handleError);
});
domainForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void addDomain(domainInput.value).then((added) => {
    if (added) domainInput.value = '';
  }).catch(handleError);
});
addCurrentButton.addEventListener('click', () => {
  void addCurrentSite().catch(handleError);
});
whitelistElement.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-domain]');
  if (button) void removeDomain(button.dataset.domain).catch(handleError);
});

void loadSettings().catch(handleError);
