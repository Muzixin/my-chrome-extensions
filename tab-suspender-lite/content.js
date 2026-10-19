(() => {
  'use strict';

  const FORM_DIRTY_MESSAGE = 'tab-suspender-lite:form-dirty';
  const dirtyElements = new Set();

  function getEditableElement(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest('input, textarea, select');
    if (control) return control;
    if (target instanceof HTMLElement && target.isContentEditable) {
      return target.closest('[contenteditable]') || target;
    }
    return null;
  }

  function markDirty(event) {
    if (!event.isTrusted) return;
    const element = getEditableElement(event.target);
    if (element) dirtyElements.add(element);
  }

  function clearForm(form) {
    for (const element of dirtyElements) {
      if (form.contains(element) || element.form === form) {
        dirtyElements.delete(element);
      }
    }
  }

  function hasUnsavedChanges() {
    for (const element of dirtyElements) {
      if (!element.isConnected) dirtyElements.delete(element);
    }
    return dirtyElements.size > 0;
  }

  document.addEventListener('input', markDirty, true);
  document.addEventListener('change', markDirty, true);
  function clearAfterEvent(event) {
    if (!event.isTrusted || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    setTimeout(() => {
      if (!event.defaultPrevented) clearForm(form);
    }, 0);
  }

  document.addEventListener('submit', clearAfterEvent);
  document.addEventListener('reset', clearAfterEvent);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === FORM_DIRTY_MESSAGE) {
      sendResponse({ dirty: hasUnsavedChanges() });
    }
    return false;
  });
})();
