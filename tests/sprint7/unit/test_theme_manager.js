#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD unit tests for dist/scripts/theme-manager.js
 *
 * Covers the pure functions extracted from main.js to enable testability.
 * The key bug being guarded against: system dark mode + toggle to light
 * used to leave the app stuck on dark because applyTheme('light') did
 * removeAttribute('data-theme') and the @media (prefers-color-scheme: dark)
 * rule still matched :root:not([data-theme]).
 */

const TestRunner = require('../../shared/test-runner');
const {
  computeToggledTheme,
  resolveInitialTheme,
  domCommandForTheme
} = require('../../../dist/scripts/theme-manager');

// ============================================
// computeToggledTheme
// ============================================

TestRunner.test('computeToggledTheme: dark → light', () => {
  TestRunner.assertEquals(computeToggledTheme('dark'), 'light');
});

TestRunner.test('computeToggledTheme: light → dark', () => {
  TestRunner.assertEquals(computeToggledTheme('light'), 'dark');
});

TestRunner.test('computeToggledTheme: null (未初始化) → dark（首次点击进 dark）', () => {
  TestRunner.assertEquals(computeToggledTheme(null), 'dark');
});

TestRunner.test('computeToggledTheme: 任意非 dark 值 → dark', () => {
  TestRunner.assertEquals(computeToggledTheme(''), 'dark');
  TestRunner.assertEquals(computeToggledTheme(undefined), 'dark');
  TestRunner.assertEquals(computeToggledTheme('garbage'), 'dark');
});

// ============================================
// resolveInitialTheme
// ============================================

TestRunner.test('resolveInitialTheme: 用户已选 dark → dark（忽略系统）', () => {
  TestRunner.assertEquals(resolveInitialTheme('dark', true), 'dark');
  TestRunner.assertEquals(resolveInitialTheme('dark', false), 'dark');
});

TestRunner.test('resolveInitialTheme: 用户已选 light → light（忽略系统）', () => {
  TestRunner.assertEquals(resolveInitialTheme('light', true), 'light');
  TestRunner.assertEquals(resolveInitialTheme('light', false), 'light');
});

TestRunner.test('resolveInitialTheme: 无保存 + 系统深色 → dark', () => {
  TestRunner.assertEquals(resolveInitialTheme(null, true), 'dark');
  TestRunner.assertEquals(resolveInitialTheme(undefined, true), 'dark');
});

TestRunner.test('resolveInitialTheme: 无保存 + 系统浅色 → light', () => {
  TestRunner.assertEquals(resolveInitialTheme(null, false), 'light');
  TestRunner.assertEquals(resolveInitialTheme(undefined, false), 'light');
});

TestRunner.test('resolveInitialTheme: 非法保存值（不是 dark/light）→ 跟随系统', () => {
  TestRunner.assertEquals(resolveInitialTheme('garbage', true), 'dark');
  TestRunner.assertEquals(resolveInitialTheme('', false), 'light');
});

// ============================================
// domCommandForTheme (核心 bug 修复点)
// ============================================

TestRunner.test('domCommandForTheme: dark → setAttribute("data-theme", "dark")', () => {
  TestRunner.assertEquals(
    JSON.stringify(domCommandForTheme('dark')),
    JSON.stringify({ action: 'setAttribute', attr: 'data-theme', value: 'dark' })
  );
});

TestRunner.test('domCommandForTheme: light → setAttribute("data-theme", "light") [bug fix]', () => {
  // 【bug 修复断言】
  // 修复前: applyTheme('light') 调 removeAttribute('data-theme')
  //   → :root:not([data-theme]) 命中 @media (prefers-color-scheme: dark)
  //   → 系统深色下，DOM 没有 data-theme 属性，CSS 仍显示深色
  // 修复后: applyTheme('light') 调 setAttribute('data-theme', 'light')
  //   → :root:not([data-theme]) 永远不命中（data-theme 总是存在）
  //   → 显式选择覆盖系统偏好
  const cmd = domCommandForTheme('light');
  TestRunner.assertEquals(cmd.action, 'setAttribute',
    'BUG REGRESSION: light theme should use setAttribute, not removeAttribute');
  TestRunner.assertEquals(cmd.attr, 'data-theme');
  TestRunner.assertEquals(cmd.value, 'light',
    'BUG REGRESSION: light theme should set data-theme="light"');
});

TestRunner.test('domCommandForTheme: 永远不返回 removeAttribute（关键不变量）', () => {
  // 关键不变量：data-theme 必须始终存在，否则 :root:not([data-theme]) 会命中媒体查询
  const lightCmd = domCommandForTheme('light');
  const darkCmd = domCommandForTheme('dark');
  if (lightCmd.action === 'removeAttribute' || darkCmd.action === 'removeAttribute') {
    throw new Error(
      'Invariant violated: domCommandForTheme returned removeAttribute. ' +
      'This would cause data-theme to be absent, allowing @media (prefers-color-scheme: dark) ' +
      'to override the explicit user choice.'
    );
  }
});

TestRunner.test('domCommandForTheme: 非法 theme 抛错', () => {
  TestRunner.assertThrows(() => domCommandForTheme('garbage'), 'garbage should throw');
  TestRunner.assertThrows(() => domCommandForTheme(''), 'empty string should throw');
  TestRunner.assertThrows(() => domCommandForTheme(null), 'null should throw');
  TestRunner.assertThrows(() => domCommandForTheme(undefined), 'undefined should throw');
});

// ============================================
// 端到端：模拟系统深色 + toggle 一次的完整流程
// ============================================

TestRunner.test('端到端: 系统深色 + 切到浅色, data-theme 应该是 "light"', () => {
  // 模拟：应用初始化（跟随系统）
  const initial = resolveInitialTheme(null, true);  // 系统深色
  const initialCmd = domCommandForTheme(initial);
  TestRunner.assertEquals(initial, 'dark', '初始应为 dark（跟随系统）');
  TestRunner.assertEquals(initialCmd.value, 'dark', '初始 DOM 应设 data-theme="dark"');

  // 模拟：用户点 toggle 按钮
  const next = computeToggledTheme(initialCmd.value);
  const nextCmd = domCommandForTheme(next);

  // 【核心断言】: data-theme 必须存在且为 'light'
  TestRunner.assertEquals(next, 'light', '切换后应为 light');
  TestRunner.assertEquals(nextCmd.action, 'setAttribute', '必须用 setAttribute');
  TestRunner.assertEquals(nextCmd.value, 'light', 'data-theme 应为 "light"');
});

TestRunner.run();
