#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for SDK install progress visualization
 *
 * Uses the REAL dist/scripts/sdk-install-progress.js state machine module.
 * The toast wiring (listen → invoke → success/failure branches) mirrors the
 * main.js flow, with in-memory invoke/event-bus doubles so no Tauri window
 * and no real npm install are needed.
 */

const { StepRegistry } = require('../shared/runner');
const SdkInstall = require('../../dist/scripts/sdk-install-progress.js');

const steps = new StepRegistry();

const PROGRESS_EVENT = 'sdk-install-progress';

// ============================================
// In-memory Tauri doubles: invoke + listen/emit
// ============================================
function buildEventBus() {
  const listeners = {};
  return {
    listen: async (name, handler) => {
      (listeners[name] = listeners[name] || []).push(handler);
      return () => {
        listeners[name] = (listeners[name] || []).filter((h) => h !== handler);
      };
    },
    emit: (name, payload) => {
      (listeners[name] || []).forEach((h) => h({ payload }));
    },
    count: (name) => (listeners[name] || []).length
  };
}

// ============================================
// Mirrored wiring (matches main.js auto-install flow)
// ============================================
function createInstallController({ invoke, bus }) {
  const ui = {
    toastVisible: true,
    progressVisible: false,
    buttonDisabled: false,
    buttonLabel: '自动安装',
    state: null
  };

  async function clickAutoInstall() {
    ui.buttonDisabled = true;
    ui.buttonLabel = '安装中…';
    ui.progressVisible = true;
    ui.state = SdkInstall.createInstallState();

    const unlisten = await bus.listen(PROGRESS_EVENT, (event) => {
      ui.state = SdkInstall.applyProgress(ui.state, event.payload);
    });

    let result;
    try {
      result = await invoke('install_pi_sdk');
    } catch (err) {
      result = {
        status: 'failed',
        error: err && err.message ? String(err.message) : String(err)
      };
    }
    ui.state = SdkInstall.applyResult(ui.state, result);
    unlisten();

    if (ui.state.phase === 'success') {
      ui.toastVisible = false;
    } else {
      ui.buttonDisabled = false;
      ui.buttonLabel = '重试';
    }
    return ui.state;
  }

  return { ui, clickAutoInstall };
}

// ============================================
// Context helpers
// ============================================
function ensureController(context) {
  if (context.controller) return;
  context.bus = buildEventBus();
  context.invoke = (cmd) => {
    if (cmd === 'install_pi_sdk') {
      if (context.installThrows) {
        return Promise.reject(new Error('invoke error: command crashed'));
      }
      // Deferred: resolved by a "the install command finishes" step
      return new Promise((resolve) => {
        context.pendingResolve = resolve;
      });
    }
    return Promise.resolve(null);
  };
  context.controller = createInstallController({ invoke: context.invoke, bus: context.bus });
}

// ============================================
// Given
// ============================================
steps.given('the install progress UI is ready', function () {
  ensureController(this);
});

steps.given('the install command will throw an invoke error', function () {
  ensureController(this);
  this.installThrows = true;
});

// ============================================
// When
// ============================================
steps.when('the user clicks 自动安装', async function () {
  ensureController(this);
  this.clickPromise = this.controller.clickAutoInstall();
  // Let immediately-settling invokes (throw case) run to completion
  await new Promise((r) => setImmediate(r));
});

steps.when('a progress event with stage {word} arrives', function (stage) {
  this.bus.emit(PROGRESS_EVENT, { stage });
});

steps.when('a progress event with stage {word} and line {string} arrives', function (stage, line) {
  this.bus.emit(PROGRESS_EVENT, { stage, message: line });
});

steps.when('the install command finishes with status {word}', async function (status) {
  if (this.pendingResolve) {
    this.pendingResolve({ status });
    this.pendingResolve = null;
  }
  await this.clickPromise;
});

steps.when('the install command finishes with status {word} and reason {string}', async function (status, reason) {
  if (this.pendingResolve) {
    this.pendingResolve({ status, error: reason });
    this.pendingResolve = null;
  }
  await this.clickPromise;
});

// ============================================
// Then
// ============================================
steps.then('the progress area should be visible', function () {
  if (!this.controller.ui.progressVisible) {
    throw new Error('Expected progress area to be visible');
  }
});

steps.then('the stage text should show {string}', function (text) {
  const actual = this.controller.ui.state && this.controller.ui.state.stage;
  if (actual !== text) {
    throw new Error(`Expected stage text "${text}", got "${actual}"`);
  }
});

steps.then('the last npm output line should show {string}', function (line) {
  const actual = this.controller.ui.state && this.controller.ui.state.lastLine;
  if (actual !== line) {
    throw new Error(`Expected last npm line "${line}", got "${actual}"`);
  }
});

steps.then('the last npm output line should still be empty', function () {
  const actual = this.controller.ui.state && this.controller.ui.state.lastLine;
  if (actual !== '') {
    throw new Error(`Expected empty last npm line, got "${actual}"`);
  }
});

steps.then('the install state should be {word}', function (phase) {
  const actual = this.controller.ui.state && this.controller.ui.state.phase;
  if (actual !== phase) {
    throw new Error(`Expected phase "${phase}", got "${actual}"`);
  }
});

steps.then('the guidance toast should be hidden', function () {
  if (this.controller.ui.toastVisible) {
    throw new Error('Expected guidance toast to be hidden');
  }
});

steps.then('the readable error should show {string}', function (reason) {
  const actual = this.controller.ui.state && this.controller.ui.state.error;
  if (actual !== reason) {
    throw new Error(`Expected error "${reason}", got "${actual}"`);
  }
});

steps.then('the install button should be retryable', function () {
  const ui = this.controller.ui;
  if (ui.buttonDisabled) {
    throw new Error('Expected install button to be enabled again');
  }
  if (ui.buttonLabel !== '重试') {
    throw new Error(`Expected button label "重试", got "${ui.buttonLabel}"`);
  }
});

module.exports = steps;
