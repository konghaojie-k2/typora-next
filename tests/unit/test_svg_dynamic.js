#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD: dynamic inline SVG pure layer (Sprint 35 / L1 + L2).
 *
 * Module under test: dist/scripts/learning/svg-dynamic.js
 * 约定：图内逻辑部件用 <g data-part data-label data-order> 分组；
 * 运行时只加 class / 图例 / 步进控制，不改 SVG 源码、不依赖 script。
 */

const TestRunner = require('../shared/test-runner');
const SvgDynamic = require('../../dist/scripts/learning/svg-dynamic');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

function fakePart(attrs) {
  return { getAttribute: (name) => (name in attrs ? attrs[name] : null) };
}

// ============================================
// normalizeOrder
// ============================================

test('normalizeOrder 解析正整数', () => {
  assertEquals(SvgDynamic.normalizeOrder('3', 0), 3, '字符串数字');
  assertEquals(SvgDynamic.normalizeOrder(5, 0), 5, '数字');
});

test('normalizeOrder 非法值回退到文档顺序', () => {
  assertEquals(SvgDynamic.normalizeOrder(null, 2), 2, 'null');
  assertEquals(SvgDynamic.normalizeOrder('abc', 2), 2, '非数字');
  assertEquals(SvgDynamic.normalizeOrder('-1', 2), 2, '负数');
  assertEquals(SvgDynamic.normalizeOrder('0', 2), 2, '零');
});

// ============================================
// collectPartsFromList
// ============================================

test('collectPartsFromList 按 data-order 排序', () => {
  const parts = SvgDynamic.collectPartsFromList([
    fakePart({ 'data-part': 'three', 'data-label': '三步', 'data-order': '3' }),
    fakePart({ 'data-part': 'one', 'data-label': '一步', 'data-order': '1' }),
    fakePart({ 'data-part': 'two', 'data-label': '二步', 'data-order': '2' })
  ]);
  assertEquals(parts.map((p) => p.id).join(','), 'one,two,three', '排序');
  assertEquals(parts.map((p) => p.label).join(','), '一步,二步,三步', '标签');
});

test('collectPartsFromList 相同 order 保持文档顺序', () => {
  const parts = SvgDynamic.collectPartsFromList([
    fakePart({ 'data-part': 'a' }),
    fakePart({ 'data-part': 'b' })
  ]);
  assertEquals(parts.map((p) => p.id).join(','), 'a,b', '稳定排序');
});

test('collectPartsFromList 缺 label 时回退到 part id', () => {
  const [part] = SvgDynamic.collectPartsFromList([fakePart({ 'data-part': 'heater' })]);
  assertEquals(part.label, 'heater', '回退标签');
});

test('collectPartsFromList 跳过没有 data-part 的节点', () => {
  const parts = SvgDynamic.collectPartsFromList([
    fakePart({}),
    fakePart({ 'data-part': 'x' })
  ]);
  assertEquals(parts.length, 1, '只保留有效 part');
});

test('collectPartsFromList 处理空输入', () => {
  assertEquals(SvgDynamic.collectPartsFromList(null).length, 0, 'null');
  assertEquals(SvgDynamic.collectPartsFromList([]).length, 0, '空数组');
});

// ============================================
// stepState
// ============================================

test('stepState 区分 past / current / future', () => {
  assertEquals(SvgDynamic.stepState(0, 1, 3), 'past', '已讲');
  assertEquals(SvgDynamic.stepState(1, 1, 3), 'current', '当前');
  assertEquals(SvgDynamic.stepState(2, 1, 3), 'future', '未讲');
});

test('stepState 未进入演示时为 idle', () => {
  assertEquals(SvgDynamic.stepState(0, -1, 3), 'idle', 'idle');
});

// ============================================
// 播放与进度
// ============================================

test('canAutoPlay 尊重 prefers-reduced-motion', () => {
  assertEquals(SvgDynamic.canAutoPlay(false), true, '默认允许');
  assertEquals(SvgDynamic.canAutoPlay(true), false, '减少动效时禁止');
});

test('formatProgress 从 0 / n 开始', () => {
  assertEquals(SvgDynamic.formatProgress(-1, 5), '0 / 5', '未开始');
  assertEquals(SvgDynamic.formatProgress(0, 5), '1 / 5', '第一步');
  assertEquals(SvgDynamic.formatProgress(4, 5), '5 / 5', '最后一步');
});

// ============================================
// 运行
// ============================================

TestRunner.run().then(({ failed }) => {
  if (failed > 0) process.exit(1);
});
