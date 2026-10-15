#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * AI 模型配置 profile——ProfileOps 纯函数层单元测试（断流容灾 2026-10-14 设计第 2 段）
 *
 * 平级卡片 + 一个激活项，无主备语义。Rust 侧规则（迁移/派生）由
 * src-tauri/tests/ai_profiles_test.rs 覆盖，两边规则须保持一致。
 *
 * Run: node tests/unit/test_ai_profiles.js
 */

const TestRunner = require('../shared/test-runner');
const { ProfileOps } = require('../../dist/scripts/settings-panel.js');

function card(name, model) {
  return { id: '', name, provider: 'openai', base_url: 'https://api.example.com', api_key: 'k-' + name, model };
}

TestRunner.test('upsert: 首张卡片自动生成 id 并自动激活', () => {
  const s = ProfileOps.upsert({ profiles: [], active_id: null }, card('DeepSeek', 'deepseek-flash'));
  TestRunner.assertEquals(s.profiles.length, 1);
  TestRunner.assert(s.profiles[0].id, 'id generated');
  TestRunner.assertEquals(s.active_id, s.profiles[0].id, 'first card auto-activated');
});

TestRunner.test('upsert: 新增不抢激活；带 id 为更新', () => {
  let s = ProfileOps.upsert({ profiles: [], active_id: null }, card('A', 'm1'));
  s = ProfileOps.upsert(s, card('B', 'm2'));
  TestRunner.assertEquals(s.profiles.length, 2);
  TestRunner.assertEquals(s.active_id, s.profiles[0].id, 'second card does not steal active');
  TestRunner.assert(s.profiles[0].id !== s.profiles[1].id, 'ids unique');

  const updated = { ...s.profiles[1], api_key: 'k-B2' };
  s = ProfileOps.upsert(s, updated);
  TestRunner.assertEquals(s.profiles.length, 2, 'update does not append');
  TestRunner.assertEquals(s.profiles[1].api_key, 'k-B2', 'update applied');
});

TestRunner.test('activate + deriveLegacy: 旧字段跟随激活卡', () => {
  let s = ProfileOps.upsert({ profiles: [], active_id: null }, card('A', 'm1'));
  s = ProfileOps.upsert(s, card('B', 'm2'));
  s = ProfileOps.activate(s, s.profiles[1].id);
  const legacy = ProfileOps.deriveLegacy(s);
  TestRunner.assertEquals(legacy.model, 'm2');
  TestRunner.assertEquals(legacy.api_key, 'k-B');
  TestRunner.assertEquals(legacy.ai_base_url, 'https://api.example.com');
  TestRunner.assertEquals(legacy.ai_provider, 'openai');
});

TestRunner.test('remove: 删除激活卡回退第一张；空列表派生 null', () => {
  let s = ProfileOps.upsert({ profiles: [], active_id: null }, card('A', 'm1'));
  s = ProfileOps.upsert(s, card('B', 'm2'));
  s = ProfileOps.activate(s, s.profiles[1].id);
  s = ProfileOps.remove(s, s.profiles[1].id);
  TestRunner.assertEquals(s.profiles.length, 1);
  TestRunner.assertEquals(s.active_id, s.profiles[0].id, 'fallback to first');
  s = ProfileOps.remove(s, s.profiles[0].id);
  TestRunner.assertEquals(s.active_id, null, 'empty → no active');
  TestRunner.assertEquals(ProfileOps.deriveLegacy(s).model, null, 'empty → null legacy');
});

TestRunner.test('activate: 不存在的 id 不改变状态', () => {
  const s = ProfileOps.upsert({ profiles: [], active_id: null }, card('A', 'm1'));
  const s2 = ProfileOps.activate(s, 'ghost');
  TestRunner.assertEquals(s2.active_id, s.active_id);
});

// ============================================
// 激活即落盘（2026-10-15 事故：激活只改内存态，
// 磁盘仍是旧卡，状态灯检磁盘配置 → 假绿）
// ============================================

const { SettingsPanel } = require('../../dist/scripts/settings-panel.js');

function panelWithTwoCards() {
  let s = { profiles: [], active_id: null };
  s = ProfileOps.upsert(s, { id: 'profile-1', name: 'A', provider: 'openai', base_url: 'https://a.example.com', api_key: 'k-A', model: 'm1' });
  s = ProfileOps.upsert(s, { id: 'profile-2', name: 'B', provider: 'openai', base_url: 'https://b.example.com', api_key: 'k-B', model: 'm2' });
  SettingsPanel._root = null; // 无 DOM：flush/hint 均有守卫
  SettingsPanel._selectedProfileId = null;
  SettingsPanel._profileState = ProfileOps.activate(s, 'profile-2');
  return SettingsPanel;
}

TestRunner.test('_persistProfiles: 激活卡内容立即写入 set_config', async () => {
  const panel = panelWithTwoCards();
  const payloads = [];
  let rechecked = false;
  panel.__setInvokeForTests(async (cmd, args) => {
    if (cmd === 'get_config') return { theme: 'dark' };
    if (cmd === 'set_config') { payloads.push(args.config); return null; }
    throw new Error('unexpected invoke: ' + cmd);
  });
  global.TyporaNext = { recheckAgentStatus: () => { rechecked = true; } };
  try {
    await panel._persistProfiles();
  } finally {
    panel.__setInvokeForTests(null);
    delete global.TyporaNext;
  }
  TestRunner.assertEquals(payloads.length, 1, 'exactly one set_config');
  const p = payloads[0];
  TestRunner.assertEquals(p.active_profile_id, 'profile-2', 'active persisted');
  TestRunner.assertEquals(p.api_key, 'k-B', 'legacy api_key follows active');
  TestRunner.assertEquals(p.ai_base_url, 'https://b.example.com', 'legacy base_url follows active');
  TestRunner.assertEquals(p.model, 'm2', 'legacy model follows active');
  TestRunner.assertEquals(p.ai_provider, 'openai', 'legacy provider follows active');
  TestRunner.assertEquals(p.theme, 'dark', 'merge-then-save keeps existing fields');
  TestRunner.assertEquals(p.ai_profiles.length, 2, 'profiles list persisted');
  TestRunner.assert(rechecked, 'persist 成功后应触发状态灯重检');
});

TestRunner.test('_persistProfiles: 落盘失败不吞错、不向调用方抛异常', async () => {
  const panel = panelWithTwoCards();
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  global.TyporaNext = undefined;
  panel.__setInvokeForTests(async (cmd) => {
    if (cmd === 'get_config') return {};
    if (cmd === 'set_config') throw new Error('disk full');
    throw new Error('unexpected invoke: ' + cmd);
  });
  let threw = false;
  try {
    await panel._persistProfiles();
  } catch (e) {
    threw = true;
  } finally {
    panel.__setInvokeForTests(null);
    console.error = origError;
    delete global.TyporaNext;
  }
  TestRunner.assert(!threw, 'must not throw into click handler');
  TestRunner.assert(errors.some((l) => l.includes('disk full')), 'error message surfaced');
});

TestRunner.test('_persistProfiles: 空列表不写盘', async () => {
  SettingsPanel._root = null;
  SettingsPanel._profileState = { profiles: [], active_id: null };
  let called = false;
  SettingsPanel.__setInvokeForTests(async () => { called = true; return null; });
  try {
    await SettingsPanel._persistProfiles();
  } finally {
    SettingsPanel.__setInvokeForTests(null);
  }
  TestRunner.assert(!called, 'empty profile list → no set_config');
});

TestRunner.run().then(({ failed }) => { if (failed > 0) process.exit(1); });
