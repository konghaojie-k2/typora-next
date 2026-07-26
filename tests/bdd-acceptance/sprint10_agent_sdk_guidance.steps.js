#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for Agent SDK startup guidance (GitHub issue #2)
 *
 * Uses in-memory invoke/storage doubles to verify guidance behavior
 * without launching Tauri or spawning node processes.
 */

const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

// ============================================
// Mirrored implementation (matches main.js)
// ============================================
const AGENT_MISSING_DISMISS_KEY = 'agent-missing-dismissed';

function createAgentSdkGuidance({ invoke, storage }) {
  let toastVisible = false;

  function showAgentMissingToast() {
    toastVisible = true;
  }

  function hideAgentMissingToast() {
    toastVisible = false;
  }

  async function probeAgentSdkAtStartup() {
    try {
      const result = await invoke('probe_agent_sdk');
      if (result && result.found) return { shown: false, reason: 'found' };
      if (storage.getItem(AGENT_MISSING_DISMISS_KEY) === '1') {
        return { shown: false, reason: 'dismissed' };
      }
      showAgentMissingToast();
      return { shown: true };
    } catch (err) {
      return { shown: false, reason: 'error' };
    }
  }

  function dismissToast() {
    storage.setItem(AGENT_MISSING_DISMISS_KEY, '1');
    hideAgentMissingToast();
  }

  async function autoInstall() {
    const result = await invoke('check_agent_sdk');
    if (result && result.available) {
      storage.removeItem(AGENT_MISSING_DISMISS_KEY);
      hideAgentMissingToast();
      return true;
    }
    return false;
  }

  return {
    probeAgentSdkAtStartup,
    dismissToast,
    autoInstall,
    isToastVisible: () => toastVisible
  };
}

function buildStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

// ============================================
// Context helpers
// ============================================
function ensureGuidance(context) {
  if (context.guidance) return;
  const sdkFound = context.sdkFound === true;
  const dismissed = context.dismissed === true;
  context.storage = buildStorage(dismissed ? { [AGENT_MISSING_DISMISS_KEY]: '1' } : {});
  context.guidance = createAgentSdkGuidance({
    invoke: async (cmd) => {
      if (cmd === 'probe_agent_sdk') {
        return sdkFound
          ? { found: true, location: '/mock/node_modules' }
          : { found: false, location: null };
      }
      if (cmd === 'check_agent_sdk') {
        return context.installSucceeds === true
          ? { available: true }
          : { available: false, error: 'npm not found' };
      }
      return null;
    },
    storage: context.storage
  });
}

// ============================================
// Given
// ============================================
steps.given('the Agent SDK is not found on the system', function() {
  this.sdkFound = false;
});

steps.given('the Agent SDK is found on the system', function() {
  this.sdkFound = true;
});

steps.given('the user has not dismissed the guidance before', function() {
  this.dismissed = false;
});

steps.given('the user has dismissed the guidance before', function() {
  this.dismissed = true;
});

// ============================================
// When
// ============================================
steps.when('the app starts and probes for the Agent SDK', async function() {
  ensureGuidance(this);
  await this.guidance.probeAgentSdkAtStartup();
});

steps.when('the user clicks 不再提示', function() {
  this.guidance.dismissToast();
});

steps.when('the user clicks 自动安装 and the SDK becomes available', async function() {
  ensureGuidance(this);
  this.installSucceeds = true;
  await this.guidance.autoInstall();
});

// ============================================
// Then
// ============================================
steps.then('the guidance toast should be shown', function() {
  if (!this.guidance.isToastVisible()) {
    throw new Error('Expected guidance toast to be visible');
  }
});

steps.then('the guidance toast should not be shown', function() {
  if (this.guidance.isToastVisible()) {
    throw new Error('Expected guidance toast to be hidden');
  }
});

steps.then('the guidance toast should be hidden', function() {
  if (this.guidance.isToastVisible()) {
    throw new Error('Expected guidance toast to be hidden');
  }
});

steps.then('the dismissal should be persisted', function() {
  if (this.storage.getItem(AGENT_MISSING_DISMISS_KEY) !== '1') {
    throw new Error('Expected dismissal flag to be persisted');
  }
});

steps.then('the dismissal should be cleared', function() {
  if (this.storage.getItem(AGENT_MISSING_DISMISS_KEY) !== null) {
    throw new Error('Expected dismissal flag to be cleared');
  }
});

module.exports = steps;
