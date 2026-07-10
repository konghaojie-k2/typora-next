#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for toolbar tooltip quick reveal
 *
 * Uses a mock DOM to verify tooltip behavior without launching Tauri.
 */

const { buildMockDOM } = require('../shared/mock-dom');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

// ============================================
// Mirrored tooltip implementation (matches main.js)
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
  let activeButton = null;

  function hideTooltip() {
    tooltip.classList.remove('visible');
    tooltip.style.opacity = '0';
    activeButton = null;
  }

  function showTooltip(button) {
    const text = button.getAttribute('data-tooltip');
    if (!text) return;
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    tooltip.style.opacity = '1';
    activeButton = button;
  }

  function scheduleShow(button) {
    clearTimer(showTimerId);
    activeButton = button;
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
  ].filter(button => button.getAttribute('data-tooltip'));

  buttons.forEach(button => {
    button.removeAttribute('title');
    button.addEventListener('mouseenter', () => scheduleShow(button));
    button.addEventListener('mouseleave', cancelShow);
    button.addEventListener('focus', () => scheduleShow(button));
    button.addEventListener('blur', cancelShow);
  });

  return { tooltip, hideTooltip, cancelShow };
}

// ============================================
// Context helpers
// ============================================
function setupToolbar(context) {
  if (context.document) return;

  const timers = [];
  context._timers = timers;
  context._now = 0;

  function fakeSetTimer(fn, ms) {
    const id = { fn, fireAt: context._now + ms };
    timers.push(id);
    return id;
  }

  function fakeClearTimer(id) {
    const idx = timers.indexOf(id);
    if (idx >= 0) timers.splice(idx, 1);
  }

  function advanceTime(ms) {
    context._now += ms;
    const ready = timers.filter(t => t.fireAt <= context._now);
    ready.forEach(t => {
      const idx = timers.indexOf(t);
      if (idx >= 0) timers.splice(idx, 1);
      t.fn();
    });
  }

  context.advanceTime = advanceTime;

  const { document } = buildMockDOM();
  context.document = document;
  context.body = document.body;

  const toolbar = document.createElement('header');
  toolbar.className = 'toolbar';

  const openFileBtn = document.createElement('button');
  openFileBtn.className = 'btn-icon';
  openFileBtn.setAttribute('data-tooltip', 'Open File (Ctrl+O)');
  openFileBtn.setAttribute('title', 'Open File (Ctrl+O)');
  toolbar.appendChild(openFileBtn);

  const openFolderBtn = document.createElement('button');
  openFolderBtn.className = 'btn-icon';
  openFolderBtn.setAttribute('data-tooltip', 'Open Folder (Ctrl+Shift+O)');
  openFolderBtn.setAttribute('title', 'Open Folder (Ctrl+Shift+O)');
  toolbar.appendChild(openFolderBtn);

  const agentChip = document.createElement('div');
  agentChip.className = 'agent-status-chip status-idle';
  agentChip.setAttribute('data-tooltip', 'Claude Code Agent 状态');
  agentChip.setAttribute('title', 'Claude Code Agent 状态');
  toolbar.appendChild(agentChip);

  context.body.appendChild(toolbar);
  context.initResult = initToolbarTooltips(document, {
    delay: 150,
    setTimer: fakeSetTimer,
    clearTimer: fakeClearTimer
  });
}

function getOpenFileButton(context) {
  const buttons = [
    ...context.document.querySelectorAll('.btn-icon'),
    ...context.document.querySelectorAll('.agent-status-chip')
  ];
  return buttons.find(b => b.getAttribute('data-tooltip') === 'Open File (Ctrl+O)') || null;
}

// ============================================
// Given
// ============================================
steps.given('the toolbar contains buttons with data-tooltips', function() {
  setupToolbar(this);
});

steps.given('a tooltip is currently visible', function() {
  setupToolbar(this);
  const button = getOpenFileButton(this);
  button._listeners.mouseenter[0]();
  this.advanceTime(150);
});

// ============================================
// When
// ============================================
steps.when('the user hovers over the open file button', function() {
  const button = getOpenFileButton(this);
  if (!button) throw new Error('Open file button not found');
  this._hoverStart = this._now;
  button._listeners.mouseenter[0]();
});

steps.when('the user moves the mouse away from the button', function() {
  const button = getOpenFileButton(this);
  if (!button) throw new Error('Open file button not found');
  button._listeners.mouseleave[0]();
});

// ============================================
// Then
// ============================================
steps.then('a tooltip should appear within 150 milliseconds', function() {
  const tooltip = this.initResult.tooltip;
  this.advanceTime(150);
  if (tooltip.style.opacity !== '1') {
    throw new Error('Tooltip did not become visible after 150ms');
  }
  const elapsed = this._now - this._hoverStart;
  if (elapsed > 150) {
    throw new Error(`Tooltip appeared too slowly: ${elapsed}ms`);
  }
});

steps.then('the tooltip text should be {string}', function(expected) {
  const tooltip = this.initResult.tooltip;
  if (tooltip.textContent !== expected) {
    throw new Error(`Expected tooltip text "${expected}", got "${tooltip.textContent}"`);
  }
});

steps.then('the tooltip should be hidden immediately', function() {
  const tooltip = this.initResult.tooltip;
  if (tooltip.style.opacity !== '0') {
    throw new Error('Tooltip is still visible after mouseleave');
  }
});

steps.then('no toolbar button should have a native title attribute', function() {
  const buttons = [
    ...this.document.querySelectorAll('.btn-icon'),
    ...this.document.querySelectorAll('.agent-status-chip')
  ].filter(b => b.getAttribute('data-tooltip'));
  for (const button of buttons) {
    if (button.getAttribute('title')) {
      throw new Error(`Button still has title attribute: ${button.getAttribute('title')}`);
    }
  }
});

module.exports = steps;
