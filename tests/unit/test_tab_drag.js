#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for tab-drag（tab 拖拽重排纯逻辑）
 *
 * 纯 Node 环境（无 DOM）：shouldStartDrag / computeDropIndex /
 * reorderArray / remapActiveIndex 全部是纯函数。
 */

const TestRunner = require('../shared/test-runner');
const TabDrag = require('../../dist/scripts/tab-drag.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

// ============================================
// shouldStartDrag
// ============================================

test('shouldStartDrag: 位移不足阈值 → false', () => {
  assertEquals(TabDrag.shouldStartDrag(100, 103), false, '3px < 默认阈值 4px');
});

test('shouldStartDrag: 位移等于阈值 → false（严格大于）', () => {
  assertEquals(TabDrag.shouldStartDrag(100, 104), false, '4px == 阈值，不算拖拽');
});

test('shouldStartDrag: 位移超过阈值 → true', () => {
  assertEquals(TabDrag.shouldStartDrag(100, 105), true, '5px > 阈值');
});

test('shouldStartDrag: 负向位移超过阈值 → true', () => {
  assertEquals(TabDrag.shouldStartDrag(100, 90), true, '向左 10px');
});

// ============================================
// computeDropIndex（midpoints = 各 tab 中心 X，先删后插语义）
// ============================================

const MID4 = [50, 150, 250, 350]; // 4 个 100px 宽的 tab

test('computeDropIndex: 指针在原位 → 0', () => {
  assertEquals(TabDrag.computeDropIndex(MID4, 50, 0), 0);
});

test('computeDropIndex: 指针刚过右侧邻居中点 → 1', () => {
  assertEquals(TabDrag.computeDropIndex(MID4, 151, 0), 1);
});

test('computeDropIndex: 指针越过所有中点 → clamp 到末尾 n-1', () => {
  assertEquals(TabDrag.computeDropIndex(MID4, 999, 0), 3);
});

test('computeDropIndex: 向左拖过首个中点 → 0', () => {
  assertEquals(TabDrag.computeDropIndex(MID4, 49, 2), 0);
});

test('computeDropIndex: 自身中点不参与统计（原地偏左仍归 0）', () => {
  // from=2，指针 100：排除自身后 50 < 100 计 1 → 插入位 1
  assertEquals(TabDrag.computeDropIndex(MID4, 100, 2), 1);
});

test('computeDropIndex: 指针恰好等于邻居中点 → 严格小于，不计入', () => {
  // from=0，指针=150（tab1 中点）：150 < 150 不成立 → 0
  assertEquals(TabDrag.computeDropIndex(MID4, 150, 0), 0);
});

// ============================================
// reorderArray
// ============================================

test('reorderArray: 向后移动', () => {
  assertEquals(
    JSON.stringify(TabDrag.reorderArray(['a', 'b', 'c', 'd'], 0, 2)),
    JSON.stringify(['b', 'c', 'a', 'd'])
  );
});

test('reorderArray: 向前移动', () => {
  assertEquals(
    JSON.stringify(TabDrag.reorderArray(['a', 'b', 'c', 'd'], 3, 1)),
    JSON.stringify(['a', 'd', 'b', 'c'])
  );
});

test('reorderArray: 恒等（from === to）', () => {
  assertEquals(
    JSON.stringify(TabDrag.reorderArray(['a', 'b', 'c'], 1, 1)),
    JSON.stringify(['a', 'b', 'c'])
  );
});

test('reorderArray: 返回新数组且不改入参', () => {
  const input = ['a', 'b', 'c'];
  const out = TabDrag.reorderArray(input, 0, 2);
  assert(out !== input, '必须返回新数组');
  assertEquals(JSON.stringify(input), JSON.stringify(['a', 'b', 'c']), '入参不得被修改');
});

// ============================================
// remapActiveIndex
// ============================================

test('remapActiveIndex: 拖的是激活 tab → 跟随到新位置', () => {
  assertEquals(TabDrag.remapActiveIndex(2, 2, 0), 0);
});

test('remapActiveIndex: 激活 tab 被向右越过 → index -1', () => {
  assertEquals(TabDrag.remapActiveIndex(1, 0, 2), 0);
});

test('remapActiveIndex: 激活 tab 被向左越过 → index +1', () => {
  assertEquals(TabDrag.remapActiveIndex(2, 3, 1), 3);
});

test('remapActiveIndex: 激活 tab 不在受影响区间 → 不变', () => {
  assertEquals(TabDrag.remapActiveIndex(3, 0, 1), 3);
});

test('remapActiveIndex: 恒等拖拽 → 不变', () => {
  assertEquals(TabDrag.remapActiveIndex(1, 1, 1), 1);
});

test('remapActiveIndex: 无激活（-1）→ 透传', () => {
  assertEquals(TabDrag.remapActiveIndex(-1, 0, 2), -1);
});

// ============================================
// Run
// ============================================

if (require.main === module) {
  console.log('Running Tab Drag tests...\n');
  TestRunner.run();
}
