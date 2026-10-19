const test = require('node:test');
const assert = require('node:assert/strict');

require('../utils.js');

const {
  DEFAULT_DELAY_MINUTES,
  MAX_DELAY_MINUTES,
  normalizeDomain,
  normalizeDelayMinutes,
  isDomainWhitelisted,
  isTabEligible,
} = globalThis.TabSuspenderLite;

test('normalizes domains and HTTP(S) URLs', () => {
  assert.equal(normalizeDomain('https://www.Example.com:8443/a'), 'example.com');
  assert.equal(normalizeDomain('*.Example.com'), 'example.com');
  assert.equal(normalizeDomain('sub.example.com.'), 'sub.example.com');
  assert.equal(normalizeDomain('javascript:alert(1)'), null);
  assert.equal(normalizeDomain('not a domain'), null);
});

test('matches a domain and its subdomains without suffix bypasses', () => {
  assert.equal(isDomainWhitelisted('https://example.com', ['example.com']), true);
  assert.equal(isDomainWhitelisted('https://app.example.com/a', ['example.com']), true);
  assert.equal(isDomainWhitelisted('https://www.example.com', ['example.com']), true);
  assert.equal(isDomainWhitelisted('https://example.com.evil.test', ['example.com']), false);
  assert.equal(isDomainWhitelisted('chrome://extensions', ['example.com']), false);
});

test('clamps and validates the suspension delay', () => {
  assert.equal(normalizeDelayMinutes(''), DEFAULT_DELAY_MINUTES);
  assert.equal(normalizeDelayMinutes('invalid'), DEFAULT_DELAY_MINUTES);
  assert.equal(normalizeDelayMinutes(0), 1);
  assert.equal(normalizeDelayMinutes(30.4), 30);
  assert.equal(normalizeDelayMinutes(100000), MAX_DELAY_MINUTES);
});

test('only eligible background HTTP(S) tabs can be discarded', () => {
  const tab = {
    id: 1,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    status: 'complete',
    url: 'https://example.com',
  };

  assert.equal(isTabEligible(tab, []), true);
  assert.equal(isTabEligible({ ...tab, active: true }, []), false);
  assert.equal(isTabEligible({ ...tab, pinned: true }, []), false);
  assert.equal(isTabEligible({ ...tab, audible: true }, []), false);
  assert.equal(isTabEligible({ ...tab, discarded: true }, []), false);
  assert.equal(isTabEligible({ ...tab, status: 'loading' }, []), false);
  assert.equal(isTabEligible({ ...tab, url: 'chrome://extensions' }, []), false);
  assert.equal(isTabEligible(tab, ['example.com']), false);
});
