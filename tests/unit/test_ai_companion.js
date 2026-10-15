#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * AI 伴学统一面板——纯函数层单元测试（CompanionCore）
 *
 * 覆盖：模式元数据完整性、建议 chips 兜底、跨模式上下文压缩（priorDiscussion）。
 * DOM 交互层由 tests/bdd-acceptance/ai_companion.steps.js 用真实模块 + mock tauri 验收。
 *
 * Run: node tests/unit/test_ai_companion.js
 */

const TestRunner = require('../shared/test-runner');
const { CompanionCore, CompanionErrors } = require('../../dist/scripts/learning/ai-companion-modal');

// ============================================
// 模式元数据
// ============================================

TestRunner.test('exactly four modes: explain / example / talk / visualize', () => {
  const keys = Object.keys(CompanionCore.MODES);
  TestRunner.assert(keys.length === 4, `should have 4 modes, got ${keys.length}`);
  for (const key of ['explain', 'example', 'talk', 'visualize']) {
    TestRunner.assert(!!CompanionCore.MODES[key], `mode '${key}' should exist`);
  }
});

TestRunner.test('every mode has label / tag / placeholder', () => {
  for (const [key, meta] of Object.entries(CompanionCore.MODES)) {
    TestRunner.assert(typeof meta.label === 'string' && meta.label.length > 0, `${key}.label required`);
    TestRunner.assert(typeof meta.tag === 'string' && meta.tag.length > 0, `${key}.tag required`);
    TestRunner.assert(typeof meta.placeholder === 'string' && meta.placeholder.length > 0, `${key}.placeholder required`);
  }
});

// ============================================
// 建议 chips
// ============================================

TestRunner.test('chipPool prefers LLM suggested questions and caps at 3', () => {
  const pool = CompanionCore.chipPool('explain', ['a', 'b', 'c', 'd', 'e']);
  TestRunner.assert(pool.length === 3, `expected 3 chips, got ${pool.length}`);
  TestRunner.assert(pool[0] === 'a' && pool[2] === 'c', 'should keep LLM order');
});

TestRunner.test('chipPool falls back per mode when no suggestions', () => {
  for (const mode of ['explain', 'example', 'talk']) {
    const pool = CompanionCore.chipPool(mode, []);
    TestRunner.assert(pool.length > 0, `${mode} fallback chips should not be empty`);
    TestRunner.assert(pool === CompanionCore.FALLBACK_CHIPS[mode] || pool.length === CompanionCore.FALLBACK_CHIPS[mode].length,
      `${mode} fallback should come from FALLBACK_CHIPS`);
  }
});

// ============================================
// priorDiscussion（跨模式上下文压缩）
// ============================================

TestRunner.test('buildPriorDiscussion returns empty string for empty thread', () => {
  TestRunner.assert(CompanionCore.buildPriorDiscussion([]) === '', 'empty thread → empty string');
  TestRunner.assert(CompanionCore.buildPriorDiscussion(null) === '', 'null thread → empty string');
});

TestRunner.test('buildPriorDiscussion labels roles and modes', () => {
  const out = CompanionCore.buildPriorDiscussion([
    { role: 'user', mode: 'talk', content: '我认为位置编码就是加坐标' },
    { role: 'tutor', mode: 'talk', content: '✅ 你说对的部分……' }
  ]);
  TestRunner.assert(out.includes('学生(💬 我有话说)：我认为位置编码就是加坐标'), 'user turn should carry role+mode tag');
  TestRunner.assert(out.includes('AI(💬 我有话说)：✅ 你说对的部分……'), 'tutor turn should carry role+mode tag');
});

TestRunner.test('buildPriorDiscussion truncates single turns at 200 chars', () => {
  const long = 'x'.repeat(500);
  const out = CompanionCore.buildPriorDiscussion([{ role: 'user', mode: 'explain', content: long }]);
  TestRunner.assert(out.length < 300, `single turn should be truncated, got ${out.length}`);
  TestRunner.assert(out.endsWith('…'), 'truncation should be marked with ellipsis');
});

TestRunner.test('buildPriorDiscussion caps total size at 1600 chars', () => {
  const turns = [];
  for (let i = 0; i < 20; i++) {
    turns.push({ role: 'user', mode: 'talk', content: 'y'.repeat(200) });
    turns.push({ role: 'tutor', mode: 'talk', content: 'z'.repeat(200) });
  }
  const out = CompanionCore.buildPriorDiscussion(turns);
  TestRunner.assert(out.length <= 1610, `total should cap near 1600, got ${out.length}`);
});

// ============================================
// CompanionErrors 错误分级（断流容灾 2026-10-14）
// ============================================

TestRunner.test('classify: STALL / AUTH_FAILED / NETWORK / UNKNOWN', () => {
  TestRunner.assertEquals(CompanionErrors.classify('模型响应中断（90 秒无数据，疑似网络或服务端断流），请重试'), 'STALL');
  TestRunner.assertEquals(CompanionErrors.classify('Agent visualize failed: HTTP 401 Unauthorized'), 'AUTH_FAILED');
  TestRunner.assertEquals(CompanionErrors.classify('403 Forbidden'), 'AUTH_FAILED');
  TestRunner.assertEquals(CompanionErrors.classify('fetch failed: getaddrinfo ENOTFOUND api.deepseek.com'), 'NETWORK');
  TestRunner.assertEquals(CompanionErrors.classify('connect ECONNREFUSED 127.0.0.1:443'), 'NETWORK');
  TestRunner.assertEquals(CompanionErrors.classify('model not resolvable: x/y'), 'UNKNOWN');
});

TestRunner.test('gradedText: STALL/NETWORK 可重试，AUTH_FAILED 不可重试，UNKNOWN 兜底', () => {
  TestRunner.assert(CompanionErrors.gradedText('STALL').includes('重试'), 'STALL 文案引导重试');
  TestRunner.assert(CompanionErrors.gradedText('AUTH_FAILED').includes('设置'), 'AUTH 文案引导设置');
  TestRunner.assertEquals(CompanionErrors.gradedText('UNKNOWN'), null, 'UNKNOWN 走默认文案');
  TestRunner.assert(CompanionErrors.retryable('STALL'), 'STALL retryable');
  TestRunner.assert(CompanionErrors.retryable('NETWORK'), 'NETWORK retryable');
  TestRunner.assert(!CompanionErrors.retryable('AUTH_FAILED'), 'AUTH 重试无意义');
});

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
