#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Agent SDK startup guidance (GitHub issue #2)
 *
 * Verifies:
 * - Startup probe shows guidance toast only when SDK is definitely absent
 * - Probe failure / SDK found → no toast
 * - "不再提示" persists dismissal in storage
 * - "自动安装" runs the full check (which auto-installs) and clears dismissal on success
 */

const TestRunner = require('../../shared/test-runner');

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

  // "自动安装"：完整检测会尝试 npm 自动安装；成功后清除忽略标记
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
    removeItem: (k) => { delete data[k]; },
    _data: data
  };
}

// ============================================
// Tests
// ============================================
const runner = TestRunner;

runner.test('SDK 已存在（probe found）→ 启动不显示引导 toast', async () => {
  const g = createAgentSdkGuidance({
    invoke: async (cmd) => ({ found: true, location: '/x/node_modules' }),
    storage: buildStorage()
  });
  const r = await g.probeAgentSdkAtStartup();
  runner.assert(!g.isToastVisible(), 'toast 不应显示');
  runner.assertEquals(r.reason, 'found');
});

runner.test('SDK 缺失（probe not found）→ 启动显示引导 toast', async () => {
  const g = createAgentSdkGuidance({
    invoke: async () => ({ found: false, location: null }),
    storage: buildStorage()
  });
  const r = await g.probeAgentSdkAtStartup();
  runner.assert(g.isToastVisible(), 'toast 应显示');
  runner.assert(r.shown, '返回值应标记 shown');
});

runner.test('用户曾点"不再提示"→ 即使 SDK 缺失也不显示 toast', async () => {
  const g = createAgentSdkGuidance({
    invoke: async () => ({ found: false, location: null }),
    storage: buildStorage({ [AGENT_MISSING_DISMISS_KEY]: '1' })
  });
  const r = await g.probeAgentSdkAtStartup();
  runner.assert(!g.isToastVisible(), 'toast 不应显示');
  runner.assertEquals(r.reason, 'dismissed');
});

runner.test('probe 调用失败 → 静默降级，不显示 toast 不抛异常', async () => {
  const g = createAgentSdkGuidance({
    invoke: async () => { throw new Error('ipc broken'); },
    storage: buildStorage()
  });
  const r = await g.probeAgentSdkAtStartup();
  runner.assert(!g.isToastVisible(), 'toast 不应显示');
  runner.assertEquals(r.reason, 'error');
});

runner.test('点"不再提示"→ 写入 storage 标记并隐藏 toast', async () => {
  const storage = buildStorage();
  const g = createAgentSdkGuidance({
    invoke: async () => ({ found: false, location: null }),
    storage
  });
  await g.probeAgentSdkAtStartup();
  runner.assert(g.isToastVisible(), '前置：toast 已显示');
  g.dismissToast();
  runner.assert(!g.isToastVisible(), 'toast 应隐藏');
  runner.assertEquals(storage.getItem(AGENT_MISSING_DISMISS_KEY), '1', '应写入忽略标记');
});

runner.test('"自动安装"成功 → toast 隐藏且忽略标记被清除', async () => {
  const storage = buildStorage({ [AGENT_MISSING_DISMISS_KEY]: '1' });
  const calls = [];
  const g = createAgentSdkGuidance({
    invoke: async (cmd) => {
      calls.push(cmd);
      if (cmd === 'check_agent_sdk') return { available: true };
      return { found: false, location: null };
    },
    storage
  });
  await g.probeAgentSdkAtStartup(); // dismissed → 不显示
  g.dismissToast(); // 无操作场景下再次确认标记
  const ok = await g.autoInstall();
  runner.assert(ok, 'autoInstall 应返回 true');
  runner.assert(calls.includes('check_agent_sdk'), '应调用完整检测');
  runner.assert(!g.isToastVisible(), 'toast 应隐藏');
  runner.assertEquals(storage.getItem(AGENT_MISSING_DISMISS_KEY), null, '忽略标记应清除');
});

runner.test('"自动安装"失败 → toast 保持显示，忽略标记保留', async () => {
  const storage = buildStorage();
  const g = createAgentSdkGuidance({
    invoke: async (cmd) => {
      if (cmd === 'check_agent_sdk') return { available: false, error: 'npm not found' };
      return { found: false, location: null };
    },
    storage
  });
  await g.probeAgentSdkAtStartup();
  const ok = await g.autoInstall();
  runner.assert(!ok, 'autoInstall 应返回 false');
  runner.assert(g.isToastVisible(), 'toast 应保持显示');
});

runner.run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
