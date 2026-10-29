#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for tab drag-to-reorder
 *
 * Two layers:
 * - Behavior: requires the REAL dist/scripts/tab-drag.js module and composes
 *   its pure functions exactly the way main.js does on drop:
 *     shouldStartDrag → computeDropIndex → reorderArray + remapActiveIndex
 *   (mouse events are NOT simulated — mock-dom has no MouseEvent; wiring is
 *   covered by the static contract test tests/unit/test_tab_drag_wiring.js)
 * - Static markup: reads the REAL dist/index.html to verify the module loads
 *   before main.js
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');
const TabDrag = require('../../dist/scripts/tab-drag.js');

const steps = new StepRegistry();

const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MODULE_JS = path.join(__dirname, '../../dist/scripts/tab-drag.js');

// Tabs are modeled as fixed 100px-wide slots: midpoints [50, 150, 250, ...]
function midpointsOf(count) {
  return Array.from({ length: count }, (_, i) => i * 100 + 50);
}

// ============================================
// Given
// ============================================
steps.given('打开的 tab 顺序为 a.md / b.md / c.md', function() {
  this.tabs = ['a.md', 'b.md', 'c.md'];
  this.midpoints = midpointsOf(this.tabs.length);
  this.active = -1;
});

steps.given('当前激活第{int}个 tab', function(n) {
  this.active = n - 1;
  this.activeFile = this.tabs[this.active];
});

steps.given('真实的 index.html', function() {
  this.html = fs.readFileSync(INDEX_HTML, 'utf-8');
});

// ============================================
// When
// ============================================
function dragTo(thisCtx, fromIdx, pointerX) {
  const from = fromIdx;
  const startX = thisCtx.midpoints[from];
  if (!TabDrag.shouldStartDrag(startX, pointerX)) {
    return; // 视为点击：不进入拖拽，顺序不变
  }
  const to = TabDrag.computeDropIndex(thisCtx.midpoints, pointerX, from);
  thisCtx.tabs = TabDrag.reorderArray(thisCtx.tabs, from, to);
  thisCtx.active = TabDrag.remapActiveIndex(thisCtx.active, from, to);
}

steps.when('用户把第{int}个 tab 向右拖过第{int}个 tab 的中点并松手', function(from, target) {
  dragTo(this, from - 1, this.midpoints[target - 1] + 1);
});

steps.when('用户把第{int}个 tab 向左拖过第{int}个 tab 的中点并松手', function(from, target) {
  dragTo(this, from - 1, this.midpoints[target - 1] - 1);
});

steps.when('用户在第{int}个 tab 上按下后移动不足阈值并松手', function(n) {
  const from = n - 1;
  const startX = this.midpoints[from];
  // 位移 3px < 默认阈值 4px → 不构成拖拽
  dragTo(this, from, startX + 3);
});

steps.when('用户拖动第{int}个 tab 但回到原位置松手', function(n) {
  const from = n - 1;
  dragTo(this, from, this.midpoints[from]);
});

// ============================================
// Then
// ============================================
function assertOrder(ctx, expected) {
  const actual = ctx.tabs.join(' / ');
  if (actual !== expected) {
    throw new Error(`tab 顺序断言失败：期望 ${expected}，实际 ${actual}`);
  }
}

steps.then('tab 顺序应变为 b.md / a.md / c.md', function() {
  assertOrder(this, 'b.md / a.md / c.md');
});

steps.then('tab 顺序应变为 c.md / a.md / b.md', function() {
  assertOrder(this, 'c.md / a.md / b.md');
});

steps.then('tab 顺序应保持 a.md / b.md / c.md', function() {
  assertOrder(this, 'a.md / b.md / c.md');
});

steps.then('激活的仍是 b.md', function() {
  if (this.tabs[this.active] !== 'b.md') {
    throw new Error(`激活 tab 断言失败：期望 b.md，实际 ${this.tabs[this.active]}（index=${this.active}）`);
  }
});

steps.then('激活的仍是 a.md', function() {
  if (this.tabs[this.active] !== 'a.md') {
    throw new Error(`激活 tab 断言失败：期望 a.md，实际 ${this.tabs[this.active]}（index=${this.active}）`);
  }
});

steps.then('页面应在 main.js 之前加载 tab-drag 模块', function() {
  const modPos = this.html.indexOf('scripts/tab-drag.js');
  const mainPos = this.html.indexOf('scripts/main.js');
  if (modPos < 0) throw new Error('index.html 未加载 scripts/tab-drag.js');
  if (mainPos < 0) throw new Error('index.html 未加载 scripts/main.js');
  if (modPos > mainPos) throw new Error('tab-drag.js 必须在 main.js 之前加载');
  if (!fs.existsSync(MODULE_JS)) {
    throw new Error('dist/scripts/tab-drag.js 在磁盘上不存在');
  }
  if (typeof TabDrag.computeDropIndex !== 'function') {
    throw new Error('tab-drag.js 未导出 computeDropIndex');
  }
});

module.exports = steps;
