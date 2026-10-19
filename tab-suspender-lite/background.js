importScripts('utils.js');

const {
  DEFAULT_DELAY_MINUTES,
  getHostname,
  isTabEligible,
  normalizeDelayMinutes,
} = globalThis.TabSuspenderLite;

const SWEEP_ALARM = 'tab-suspender-lite-sweep';
const LAST_ACTIVE_PREFIX = 'lastActive:';
const ACTIVE_WINDOW_PREFIX = 'activeWindow:';
const FORM_DIRTY_MESSAGE = 'tab-suspender-lite:form-dirty';
const FRAME_QUERY_TIMEOUT_MS = 1500;
const SETTINGS_DEFAULTS = {
  delayMinutes: DEFAULT_DELAY_MINUTES,
  whitelist: [],
};

let operationQueue = Promise.resolve();
let sweepPromise = Promise.resolve();
let sweepPending = false;
let stateRevision = 0;

function reportError(error) {
  console.error('[Tab Suspender Lite]', error);
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(SWEEP_ALARM);
  if (!alarm) {
    await chrome.alarms.create(SWEEP_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  }
}

async function reconcileTabs() {
  const [tabs, session] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.session.get(null),
  ]);
  const now = Date.now();
  const updates = {};

  for (const tab of tabs) {
    const lastActiveKey = `${LAST_ACTIVE_PREFIX}${tab.id}`;
    if (!Number.isFinite(session[lastActiveKey])) updates[lastActiveKey] = now;
    if (tab.active) updates[`${ACTIVE_WINDOW_PREFIX}${tab.windowId}`] = tab.id;
  }

  if (Object.keys(updates).length > 0) await chrome.storage.session.set(updates);
}

async function initialize() {
  await ensureAlarm();
  await reconcileTabs();
}

const initialized = initialize().catch(reportError);

function enqueue(operation) {
  operationQueue = operationQueue.then(async () => {
    try {
      await initialized;
      await operation();
    } catch (error) {
      reportError(error);
    }
  });
  return operationQueue;
}

function listen(event, handler) {
  event.addListener((...args) => {
    stateRevision += 1;
    void enqueue(() => handler(...args));
  });
}

async function waitForStateEvents() {
  for (;;) {
    const revision = stateRevision;
    await operationQueue;
    if (revision === stateRevision) return;
  }
}

async function handleActivated({ tabId, windowId }) {
  const activeWindowKey = `${ACTIVE_WINDOW_PREFIX}${windowId}`;
  const session = await chrome.storage.session.get(activeWindowKey);
  const previousTabId = session[activeWindowKey];
  const now = Date.now();
  const updates = {
    [activeWindowKey]: tabId,
    [`${LAST_ACTIVE_PREFIX}${tabId}`]: now,
  };

  if (Number.isInteger(previousTabId) && previousTabId !== tabId) {
    updates[`${LAST_ACTIVE_PREFIX}${previousTabId}`] = now;
  }
  await chrome.storage.session.set(updates);
}

async function handleRemoved(tabId, { windowId }) {
  const activeWindowKey = `${ACTIVE_WINDOW_PREFIX}${windowId}`;
  const session = await chrome.storage.session.get(activeWindowKey);
  const keys = [`${LAST_ACTIVE_PREFIX}${tabId}`];
  if (session[activeWindowKey] === tabId) keys.push(activeWindowKey);
  await chrome.storage.session.remove(keys);
}

async function withTimeout(promise) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), FRAME_QUERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function shouldProtectForForms(tabId) {
  try {
    const frames = await withTimeout(chrome.webNavigation.getAllFrames({ tabId }));
    const httpFrames = (frames || []).filter((frame) => getHostname(frame.url));
    if (httpFrames.length === 0) return true;

    const statuses = await Promise.all(httpFrames.map(async (frame) => {
      try {
        const response = await withTimeout(chrome.tabs.sendMessage(
          tabId,
          { type: FORM_DIRTY_MESSAGE },
          { frameId: frame.frameId },
        ));
        if (response?.dirty === true) return 'dirty';
        if (response?.dirty === false) return 'clean';
        return 'unknown';
      } catch {
        return 'unknown';
      }
    }));

    return statuses.some((status) => status !== 'clean');
  } catch {
    return true;
  }
}

async function readSnapshot(tabId) {
  const lastActiveKey = `${LAST_ACTIVE_PREFIX}${tabId}`;
  const [tab, session, settings] = await Promise.all([
    chrome.tabs.get(tabId),
    chrome.storage.session.get(lastActiveKey),
    chrome.storage.local.get(SETTINGS_DEFAULTS),
  ]);

  return {
    tab,
    lastActive: session[lastActiveKey],
    delayMs: normalizeDelayMinutes(settings.delayMinutes) * 60_000,
    whitelist: Array.isArray(settings.whitelist) ? settings.whitelist : [],
  };
}

function isExpiredSnapshot({ tab, lastActive, delayMs, whitelist }) {
  return isTabEligible(tab, whitelist)
    && Number.isFinite(lastActive)
    && Date.now() - lastActive >= delayMs;
}

async function discardIfEligible(tabId) {
  try {
    await waitForStateEvents();
    const initial = await readSnapshot(tabId);
    if (!isExpiredSnapshot(initial)) return;
    if (await shouldProtectForForms(tabId)) return;

    // Drain pending tab events, then detect any new event during the final read.
    await waitForStateEvents();
    const validationRevision = stateRevision;
    const latest = await readSnapshot(tabId);
    if (validationRevision !== stateRevision || !isExpiredSnapshot(latest)) return;
    await chrome.tabs.discard(tabId);
  } catch {
    // Tabs can close, navigate, or become active while the sweep is running.
  }
}

async function sweep() {
  await waitForStateEvents();
  const [settings, tabs, session] = await Promise.all([
    chrome.storage.local.get(SETTINGS_DEFAULTS),
    chrome.tabs.query({}),
    chrome.storage.session.get(null),
  ]);
  const delayMs = normalizeDelayMinutes(settings.delayMinutes) * 60_000;
  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
  const now = Date.now();
  const updates = {};
  const candidates = [];

  for (const tab of tabs) {
    const lastActiveKey = `${LAST_ACTIVE_PREFIX}${tab.id}`;
    const lastActive = session[lastActiveKey];
    if (!Number.isFinite(lastActive)) {
      updates[lastActiveKey] = now;
      continue;
    }
    if (!isTabEligible(tab, whitelist)) continue;
    if (now - lastActive >= delayMs) candidates.push(tab.id);
  }

  if (Object.keys(updates).length > 0) await chrome.storage.session.set(updates);
  for (const tabId of candidates) await discardIfEligible(tabId);
}

listen(chrome.tabs.onActivated, handleActivated);
listen(chrome.tabs.onCreated, (tab) =>
  chrome.storage.session.set({ [`${LAST_ACTIVE_PREFIX}${tab.id}`]: Date.now() }),
);
listen(chrome.tabs.onUpdated, (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    return chrome.storage.session.set({
      [`${LAST_ACTIVE_PREFIX}${tabId}`]: Date.now(),
    });
  }
  return undefined;
});
listen(chrome.tabs.onRemoved, handleRemoved);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SWEEP_ALARM || sweepPending) return;
  sweepPending = true;
  sweepPromise = (async () => {
    try {
      await initialized;
      await sweep();
    } catch (error) {
      reportError(error);
    } finally {
      sweepPending = false;
    }
  })();
});
