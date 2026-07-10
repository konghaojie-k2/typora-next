#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for toolbar tooltip quick reveal
 *
 * Verifies:
 * - Tooltip appears after 150ms delay
 * - Tooltip text comes from data-tooltip
 * - Native title attribute is removed
 * - Mouseleave hides tooltip immediately
 * - Rapid enter/leave cancels pending show
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Minimal mirrored implementation
// ============================================
function initToolbarTooltips(document, options = {}) {
  const delay = options.delay ?? 150;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  const tooltip = document.createElement('div');
  tooltip.className = 'toolbar-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.opacity = '0';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = '9999';
  document.body.appendChild(tooltip);

  let showTimerId = null;

  function hideTooltip() {
    tooltip.classList.remove('visible');
    tooltip.style.opacity = '0';
  }

  function showTooltip(button) {
    const text = button.getAttribute('data-tooltip');
    if (!text) return;
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    tooltip.style.opacity = '1';
  }

  function scheduleShow(button) {
    clearTimer(showTimerId);
    showTimerId = setTimer(() => {
      showTooltip(button);
    }, delay);
  }

  function cancelShow() {
    clearTimer(showTimerId);
    showTimerId = null;
    hideTooltip();
  }

  const buttons = [
    ...document.querySelectorAll('.btn-icon'),
    ...document.querySelectorAll('.agent-status-chip')
  ].filter(b => b.getAttribute('data-tooltip'));

  buttons.forEach(button => {
    button.removeAttribute('title');
    button.addEventListener('mouseenter', () => scheduleShow(button));
    button.addEventListener('mouseleave', cancelShow);
    button.addEventListener('focus', () => scheduleShow(button));
    button.addEventListener('blur', cancelShow);
  });

  return { tooltip, hideTooltip, cancelShow };
}

function buildFakeDocument() {
  const buttons = [];

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      _attrs: {},
      _classes: [],
      _listeners: {},
      _children: [],
      style: {},
      textContent: '',

      classList: {
        add(c) { if (!el._classes.includes(c)) el._classes.push(c); },
        remove(c) { el._classes = el._classes.filter(x => x !== c); },
        contains(c) { return el._classes.includes(c); }
      },

      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] ?? null; },
      removeAttribute(k) { delete el._attrs[k]; },

      appendChild(c) {
        el._children.push(c);
        c._parent = el;
        return c;
      },

      addEventListener(ev, fn) {
        (el._listeners[ev] = el._listeners[ev] || []).push(fn);
      },

      removeEventListener(ev, fn) {
        if (el._listeners[ev]) {
          el._listeners[ev] = el._listeners[ev].filter(f => f !== fn);
        }
      }
    };
    return el;
  }

  const body = createElement('body');

  return {
    body,
    createElement,
    _buttons: buttons,

    addButton(cls, dataTooltip, title) {
      const btn = createElement('button');
      btn._classes = cls.split(/\s+/);
      btn.setAttribute('data-tooltip', dataTooltip);
      if (title) btn.setAttribute('title', title);
      body.appendChild(btn);
      buttons.push(btn);
      return btn;
    },

    querySelectorAll(sel) {
      if (sel === '.btn-icon[data-tooltip], .agent-status-chip[data-tooltip]') {
        return buttons.filter(b => b.getAttribute('data-tooltip') &&
          (b._classes.includes('btn-icon') || b._classes.includes('agent-status-chip')));
      }
      if (sel === '.btn-icon') {
        return buttons.filter(b => b._classes.includes('btn-icon'));
      }
      if (sel === '.agent-status-chip') {
        return buttons.filter(b => b._classes.includes('agent-status-chip'));
      }
      return [];
    }
  };
}

function createTimerController() {
  let now = 0;
  const timers = [];

  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = { fn, fireAt: now + ms };
      timers.push(id);
      return id;
    },
    clearTimer(id) {
      const idx = timers.indexOf(id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    advance(ms) {
      now += ms;
      const ready = timers.filter(t => t.fireAt <= now);
      ready.forEach(t => {
        const idx = timers.indexOf(t);
        if (idx >= 0) timers.splice(idx, 1);
        t.fn();
      });
    }
  };
}

// ============================================
// Tests
// ============================================
TestRunner.test('Tooltip appears after 150ms delay on mouseenter', () => {
  const doc = buildFakeDocument();
  const timer = createTimerController();
  const btn = doc.addButton('btn-icon', 'Open File (Ctrl+O)', 'Open File (Ctrl+O)');

  const { tooltip } = initToolbarTooltips(doc, {
    delay: 150,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  TestRunner.assertEquals(tooltip.style.opacity, '0', 'Tooltip should be hidden initially');
  btn._listeners.mouseenter[0]();
  TestRunner.assertEquals(tooltip.style.opacity, '0', 'Tooltip should not show immediately');

  timer.advance(149);
  TestRunner.assertEquals(tooltip.style.opacity, '0', 'Tooltip should not show before delay');

  timer.advance(1);
  TestRunner.assertEquals(tooltip.style.opacity, '1', 'Tooltip should show after 150ms');
  TestRunner.assertEquals(tooltip.textContent, 'Open File (Ctrl+O)', 'Tooltip text mismatch');
});

TestRunner.test('Native title attribute is removed from toolbar buttons', () => {
  const doc = buildFakeDocument();
  doc.addButton('btn-icon', 'Open File (Ctrl+O)', 'Open File (Ctrl+O)');
  doc.addButton('btn-icon', 'Open Folder (Ctrl+Shift+O)', 'Open Folder (Ctrl+Shift+O)');
  doc.addButton('agent-status-chip status-idle', 'Agent Status', 'Agent Status');

  initToolbarTooltips(doc);

  doc._buttons.forEach(btn => {
    TestRunner.assertEquals(btn.getAttribute('title'), null, `Title should be removed for ${btn.getAttribute('data-tooltip')}`);
  });
});

TestRunner.test('Mouseleave hides tooltip immediately', () => {
  const doc = buildFakeDocument();
  const timer = createTimerController();
  const btn = doc.addButton('btn-icon', 'Open File (Ctrl+O)', 'Open File (Ctrl+O)');

  const { tooltip } = initToolbarTooltips(doc, {
    delay: 150,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  btn._listeners.mouseenter[0]();
  timer.advance(150);
  TestRunner.assertEquals(tooltip.style.opacity, '1', 'Tooltip should be visible');

  btn._listeners.mouseleave[0]();
  TestRunner.assertEquals(tooltip.style.opacity, '0', 'Tooltip should hide on mouseleave');
});

TestRunner.test('Rapid mouseenter/mouseleave cancels pending tooltip', () => {
  const doc = buildFakeDocument();
  const timer = createTimerController();
  const btn = doc.addButton('btn-icon', 'Open File (Ctrl+O)', 'Open File (Ctrl+O)');

  const { tooltip } = initToolbarTooltips(doc, {
    delay: 150,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  btn._listeners.mouseenter[0]();
  timer.advance(80);
  btn._listeners.mouseleave[0]();
  timer.advance(100);
  TestRunner.assertEquals(tooltip.style.opacity, '0', 'Tooltip should not appear after rapid leave');
});

TestRunner.test('Moving from one button to another updates tooltip text', () => {
  const doc = buildFakeDocument();
  const timer = createTimerController();
  const btnA = doc.addButton('btn-icon', 'Open File (Ctrl+O)', 'Open File (Ctrl+O)');
  const btnB = doc.addButton('btn-icon', 'Open Folder (Ctrl+Shift+O)', 'Open Folder (Ctrl+Shift+O)');

  const { tooltip } = initToolbarTooltips(doc, {
    delay: 150,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  btnA._listeners.mouseenter[0]();
  timer.advance(150);
  TestRunner.assertEquals(tooltip.textContent, 'Open File (Ctrl+O)', 'First tooltip text mismatch');

  btnA._listeners.mouseleave[0]();
  btnB._listeners.mouseenter[0]();
  timer.advance(150);
  TestRunner.assertEquals(tooltip.textContent, 'Open Folder (Ctrl+Shift+O)', 'Second tooltip text mismatch');
});

// Run
TestRunner.run();
