#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 7: Theme Switch (内存模拟层)
 * Feature: tests/features/sprint7_theme_switch.feature
 *
 * 关键 bug: 系统深色模式下用户从深色切到浅色，应用仍然显示深色
 * 根因: applyTheme('light') 使用 removeAttribute('data-theme')，
 *       导致 :root:not([data-theme]) 命中 prefers-color-scheme: dark 媒体查询
 * 修复: applyTheme('light') 改为 setAttribute('data-theme', 'light')
 *
 * 本 step defs 直接 require dist/scripts/theme-manager.js（修复后的纯函数模块），
 * 模拟 user/app/system 之间的交互，验证关键不变量。
 */

const { StepRegistry } = require('./runner');

if (typeof global.window === 'undefined') global.window = {};
const { computeToggledTheme, resolveInitialTheme, domCommandForTheme } =
  require('../../dist/scripts/theme-manager');

const steps = new StepRegistry();

// ============================================
// 测试上下文：模拟一个最小化环境
// ============================================
// context = {
//   systemPrefersDark: boolean,     // 模拟系统主题
//   savedTheme: string | null,      // 模拟 localStorage
//   rootAttrs: object,              // 模拟 <html> 上的属性（key → value）
//   currentTheme: string | null,    // 应用"当前"显示的主题
//   clickCount: int,                // 累计点击次数
// }

function getCurrentTheme(ctx) {
  // 模拟应用从 DOM 读取当前主题
  return ctx.rootAttrs['data-theme'] || null;
}

function applyThemeToMock(ctx, theme) {
  // 用修复后的逻辑：总是 setAttribute（不 remove）
  const cmd = domCommandForTheme(theme);
  if (cmd.action === 'setAttribute') {
    ctx.rootAttrs[cmd.attr] = cmd.value;
  } else if (cmd.action === 'removeAttribute') {
    delete ctx.rootAttrs[cmd.attr];
  }
  ctx.currentTheme = theme;
  ctx.savedTheme = theme;
}

function simulateToggleClick(ctx) {
  // 模拟"用户点 toggle 按钮 → 触发 applyTheme"
  const current = getCurrentTheme(ctx);
  const next = computeToggledTheme(current);
  applyThemeToMock(ctx, next);
  ctx.clickCount = (ctx.clickCount || 0) + 1;
}

function simulateAppStart(ctx) {
  // 模拟应用 initTheme 流程
  const initial = resolveInitialTheme(ctx.savedTheme, ctx.systemPrefersDark);
  applyThemeToMock(ctx, initial);
}

// ============================================
// Given
// ============================================

steps.given('系统处于深色模式', async function() {
  this.systemPrefersDark = true;
});

steps.given('系统处于浅色模式', async function() {
  this.systemPrefersDark = false;
});

steps.given('应用当前显示深色主题', async function() {
  this.rootAttrs = {};
  this.currentTheme = null;
  this.savedTheme = null;
  applyThemeToMock(this, 'dark');
});

steps.given('应用当前显示浅色主题', async function() {
  this.rootAttrs = {};
  this.currentTheme = null;
  this.savedTheme = null;
  applyThemeToMock(this, 'light');
});

steps.given('用户从未手动选择过主题', async function() {
  this.savedTheme = null;
  if (!this.rootAttrs) this.rootAttrs = {};
});

// ============================================
// When
// ============================================

steps.when('用户点击切换主题按钮', async function() {
  simulateToggleClick(this);
});

steps.when('用户连续两次点击切换主题按钮', async function() {
  simulateToggleClick(this);
  simulateToggleClick(this);
});

steps.when('应用启动并完成初始化', async function() {
  simulateAppStart(this);
});

// ============================================
// Then
// ============================================

steps.then('应用应该切换到浅色主题', async function() {
  if (this.currentTheme !== 'light') {
    throw new Error(`Expected current theme 'light', got '${this.currentTheme}'`);
  }
});

steps.then('应用应该切换到深色主题', async function() {
  if (this.currentTheme !== 'dark') {
    throw new Error(`Expected current theme 'dark', got '${this.currentTheme}'`);
  }
});

steps.then('应用应该保持深色主题', async function() {
  if (this.currentTheme !== 'dark') {
    throw new Error(`Expected current theme to remain 'dark', got '${this.currentTheme}'`);
  }
});

steps.then('应用应该最终显示浅色主题', async function() {
  if (this.currentTheme !== 'light') {
    throw new Error(`Expected final theme 'light', got '${this.currentTheme}'`);
  }
});

steps.then('应用应该最终显示深色主题', async function() {
  if (this.currentTheme !== 'dark') {
    throw new Error(`Expected final theme 'dark', got '${this.currentTheme}'`);
  }
});

steps.then('应用应该显示深色主题', async function() {
  if (this.currentTheme !== 'dark') {
    throw new Error(`Expected current theme 'dark', got '${this.currentTheme}'`);
  }
});

steps.then('data-theme 属性应该存在且值为 {string}', async function(value) {
  const attr = this.rootAttrs && this.rootAttrs['data-theme'];
  if (attr !== value) {
    throw new Error(`Expected data-theme='${value}', got data-theme='${attr}'`);
  }
});

steps.then('data-theme 不应该被移除（不能为空）', async function() {
  // 关键不变量: data-theme 必须始终存在（值是 'light' 或 'dark'）
  // 如果不存在，:root:not([data-theme]) 会命中 prefers-color-scheme: dark 媒体查询
  const attr = this.rootAttrs && this.rootAttrs['data-theme'];
  if (!attr) {
    throw new Error(
      'Invariant violated: data-theme is missing. ' +
      'This causes :root:not([data-theme]) to match @media (prefers-color-scheme: dark), ' +
      'which is the root cause of the system-dark-mode + toggle-to-light bug.'
    );
  }
});

module.exports = steps;

// Allow running this file directly: node sprint7_steps.js
if (require.main === module) {
  // Filter to only sprint7 feature file
  const { runFeatures } = require('./runner');
  const path = require('path');
  const fs = require('fs');
  const featureFile = path.join(__dirname, '..', 'features', 'sprint7_theme_switch.feature');
  const content = fs.readFileSync(featureFile, 'utf-8');
  const { parseFeature } = require('./runner');
  const scenarios = parseFeature(content);

  (async () => {
    let passed = 0, failed = 0;
    for (const scenario of scenarios) {
      process.stdout.write(`  ${scenario.name} ... `);
      const context = {};
      try {
        for (const step of scenario.steps) {
          await steps.runStep(step.text, context);
        }
        console.log('✅ PASS');
        passed++;
      } catch (e) {
        console.log('❌ FAIL');
        console.log('    ' + e.message);
        failed++;
      }
    }
    console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
    process.exit(failed > 0 ? 1 : 0);
  })();
}
