(function attachUtils(root) {
  'use strict';

  const DEFAULT_DELAY_MINUTES = 30;
  const MAX_DELAY_MINUTES = 10080;

  function parseHttpUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  function normalizeHostname(hostname) {
    let normalized = hostname.toLowerCase().replace(/\.$/, '');
    if (normalized.startsWith('www.')) normalized = normalized.slice(4);
    return normalized || null;
  }

  function normalizeDomain(input) {
    if (typeof input !== 'string') return null;
    let value = input.trim().toLowerCase();
    if (!value) return null;
    if (value.startsWith('*.')) value = value.slice(2);

    let candidate;
    if (value.startsWith('//')) {
      candidate = `https:${value}`;
    } else if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
      candidate = value;
    } else {
      if (/^[a-z][a-z0-9+.-]*:(?!\d)/.test(value)) return null;
      candidate = `https://${value}`;
    }

    const url = parseHttpUrl(candidate);
    return url ? normalizeHostname(url.hostname) : null;
  }

  function getHostname(value) {
    const url = parseHttpUrl(value);
    return url ? normalizeHostname(url.hostname) : null;
  }

  function isDomainWhitelisted(tabUrl, whitelist) {
    const hostname = getHostname(tabUrl);
    if (!hostname || !Array.isArray(whitelist)) return false;

    return whitelist.some((rule) => {
      const domain = normalizeDomain(rule);
      return domain && (hostname === domain || hostname.endsWith(`.${domain}`));
    });
  }

  function normalizeDelayMinutes(value) {
    if (value === null || value === undefined || value === '') {
      return DEFAULT_DELAY_MINUTES;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_DELAY_MINUTES;
    return Math.min(MAX_DELAY_MINUTES, Math.max(1, Math.round(parsed)));
  }

  function isTabEligible(tab, whitelist) {
    if (!tab || typeof tab.id !== 'number') return false;
    if (tab.active || tab.pinned || tab.audible || tab.discarded) return false;
    if (tab.status !== 'complete' || !getHostname(tab.url)) return false;
    return !isDomainWhitelisted(tab.url, whitelist);
  }

  root.TabSuspenderLite = Object.freeze({
    DEFAULT_DELAY_MINUTES,
    MAX_DELAY_MINUTES,
    normalizeDomain,
    getHostname,
    isDomainWhitelisted,
    normalizeDelayMinutes,
    isTabEligible,
  });
})(globalThis);
