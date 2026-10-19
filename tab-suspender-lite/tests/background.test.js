const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ALARM_NAME = 'tab-suspender-lite-sweep';

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

function createStorageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      if (typeof keys === 'string') {
        return Object.hasOwn(data, keys) ? { [keys]: structuredClone(data[keys]) } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => Object.hasOwn(data, key))
            .map((key) => [key, structuredClone(data[key])]),
        );
      }
      const result = structuredClone(keys);
      for (const key of Object.keys(keys)) {
        if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key]);
      }
      return result;
    },
    async set(updates) {
      Object.assign(data, structuredClone(updates));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function makeTab(id, overrides = {}) {
  return {
    id,
    windowId: 1,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    status: 'complete',
    url: `https://site-${id}.example/`,
    ...overrides,
  };
}

async function createHarness({ tabs, settings = {}, frames = {}, responses = {} }) {
  let now = 1_000_000;
  const tabMap = new Map(tabs.map((tab) => [tab.id, { ...tab }]));
  const local = createStorageArea({ delayMinutes: 1, whitelist: [], ...settings });
  const session = createStorageArea();
  const discardedIds = [];
  const errors = [];
  const alarmState = {};

  const chrome = {
    alarms: {
      onAlarm: createEvent(),
      async get(name) {
        return alarmState[name] || null;
      },
      async create(name, info) {
        alarmState[name] = { name, ...info };
      },
    },
    storage: { local, session },
    tabs: {
      onActivated: createEvent(),
      onCreated: createEvent(),
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      async query() {
        return [...tabMap.values()].map((tab) => ({ ...tab }));
      },
      async get(tabId) {
        const tab = tabMap.get(tabId);
        if (!tab) throw new Error(`Missing tab ${tabId}`);
        return { ...tab };
      },
      async discard(tabId) {
        const tab = tabMap.get(tabId);
        if (!tab || tab.active || tab.discarded) throw new Error('Not discardable');
        tab.discarded = true;
        discardedIds.push(tabId);
        return { ...tab };
      },
      async sendMessage(tabId, _message, { frameId }) {
        const key = `${tabId}:${frameId}`;
        const response = Object.hasOwn(responses, key) ? responses[key] : false;
        if (response === 'missing') throw new Error('No receiver');
        if (response === 'hang') return new Promise(() => {});
        if (response === 'unknown') return undefined;
        return { dirty: response };
      },
    },
    webNavigation: {
      async getAllFrames({ tabId }) {
        if (frames[tabId] === 'missing') return null;
        if (frames[tabId]) return structuredClone(frames[tabId]);
        return [{ frameId: 0, url: tabMap.get(tabId)?.url }];
      },
    },
  };

  const context = vm.createContext({
    chrome,
    URL,
    Date: { now: () => now },
    setTimeout,
    clearTimeout,
    console: {
      error(...args) {
        errors.push(args);
      },
    },
  });
  context.importScripts = (...files) => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      vm.runInContext(source, context, { filename: file });
    }
  };

  const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'background.js' });
  await vm.runInContext('initialized', context);

  async function flush() {
    const pendingSweep = vm.runInContext('sweepPromise', context);
    await Promise.all([
      vm.runInContext('operationQueue', context),
      pendingSweep,
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    await vm.runInContext('operationQueue', context);
  }

  return {
    chrome,
    discardedIds,
    errors,
    advance(milliseconds) {
      now += milliseconds;
    },
    activate(tabId, windowId = 1) {
      for (const tab of tabMap.values()) {
        if (tab.windowId === windowId) tab.active = tab.id === tabId;
      }
      chrome.tabs.onActivated.emit({ tabId, windowId });
    },
    async sweep() {
      chrome.alarms.onAlarm.emit({ name: ALARM_NAME });
      await flush();
    },
    flush,
  };
}

test('discards only expired eligible tabs', async () => {
  const harness = await createHarness({
    settings: { whitelist: ['example.com'] },
    tabs: [
      makeTab(1),
      makeTab(2, { active: true }),
      makeTab(3, { pinned: true }),
      makeTab(4, { url: 'https://app.example.com/' }),
      makeTab(5, { audible: true }),
    ],
  });

  harness.advance(60_001);
  await harness.sweep();

  assert.deepEqual(harness.discardedIds, [1]);
  assert.deepEqual(harness.errors, []);
});

test('switching tabs restarts the previous tab idle timer', async () => {
  const harness = await createHarness({
    tabs: [makeTab(1, { active: true }), makeTab(2)],
  });

  harness.advance(120_000);
  harness.activate(2);
  await harness.flush();
  await harness.sweep();
  assert.deepEqual(harness.discardedIds, []);

  harness.advance(60_001);
  await harness.sweep();
  assert.deepEqual(harness.discardedIds, [1]);
  assert.deepEqual(harness.errors, []);
});

test('a hung frame query times out without blocking other tabs', async () => {
  const harness = await createHarness({
    tabs: [makeTab(1), makeTab(2), makeTab(99, { active: true })],
    responses: { '2:0': 'hang' },
  });

  harness.advance(60_001);
  await harness.sweep();

  assert.deepEqual(harness.discardedIds, [1]);
  assert.deepEqual(harness.errors, []);
});

test('dirty, iframe-dirty, and unknown form states are protected', async () => {
  const harness = await createHarness({
    tabs: [makeTab(1), makeTab(2), makeTab(3), makeTab(4), makeTab(99, { active: true })],
    frames: {
      4: [
        { frameId: 0, url: 'https://site-4.example/' },
        { frameId: 7, url: 'https://iframe.example/form' },
      ],
    },
    responses: {
      '2:0': true,
      '3:0': 'missing',
      '4:0': false,
      '4:7': true,
    },
  });

  harness.advance(60_001);
  await harness.sweep();

  assert.deepEqual(harness.discardedIds, [1]);
  assert.deepEqual(harness.errors, []);
});
