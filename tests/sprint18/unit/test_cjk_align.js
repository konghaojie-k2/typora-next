#!/usr/bin/env node
/**
 * TDD Tests for cjk-align.js — 代码块 CJK 字宽补偿（ASCII 线框图对齐）
 *
 * 背景：pre code 字体栈不含 CJK 字形，回退字体字宽 ≠ 2×拉丁等宽字宽，
 * 导致按 2 列对齐绘制的线框图右边框漂移。cjk-align.js 实测字宽后用
 * letter-spacing 把每个 CJK 字符补足到 2 列。
 */

const TestRunner = require('../../shared/test-runner');
const CJKAlign = require('../../../dist/scripts/cjk-align');

// ============================================
// containsCJK
// ============================================

TestRunner.test('containsCJK: 纯 ASCII 返回 false', () => {
  TestRunner.assertEquals(CJKAlign.containsCJK('hello world --> tag'), false);
});

TestRunner.test('containsCJK: 含中文返回 true', () => {
  TestRunner.assertEquals(CJKAlign.containsCJK('│ 查询编排层 (API / Agent)'), true);
});

TestRunner.test('containsCJK: 全角标点/全角空格也算 CJK', () => {
  TestRunner.assertEquals(CJKAlign.containsCJK('a，b'), true);   // 全角逗号
  TestRunner.assertEquals(CJKAlign.containsCJK('a　b'), true);   // 全角空格 U+3000
});

TestRunner.test('containsCJK: 制表符/盒线字符不算 CJK', () => {
  TestRunner.assertEquals(CJKAlign.containsCJK('┌──┐ │ └─┘ ▼ ◄ ►'), false);
});

// ============================================
// computeLetterSpacing
// ============================================

TestRunner.test('computeLetterSpacing: 2:1 字体返回 null（零侵入）', () => {
  TestRunner.assertEquals(CJKAlign.computeLetterSpacing(8, 16), null);
});

TestRunner.test('computeLetterSpacing: CJK 偏窄时返回正补偿', () => {
  // JetBrains Mono latin≈0.6em，雅黑 CJK≈1em → diff = 2*8.4 - 14 = 2.8
  const diff = CJKAlign.computeLetterSpacing(8.4, 14);
  TestRunner.assert(Math.abs(diff - 2.8) < 1e-9, `expected ~2.8, got ${diff}`);
});

TestRunner.test('computeLetterSpacing: CJK 偏宽时返回负补偿', () => {
  const diff = CJKAlign.computeLetterSpacing(7, 15);
  TestRunner.assertEquals(diff, -1);
});

TestRunner.test('computeLetterSpacing: 亚像素差异返回 null', () => {
  TestRunner.assertEquals(CJKAlign.computeLetterSpacing(8, 15.9), null);
});

TestRunner.test('computeLetterSpacing: 非法输入返回 null', () => {
  TestRunner.assertEquals(CJKAlign.computeLetterSpacing(0, 16), null);
  TestRunner.assertEquals(CJKAlign.computeLetterSpacing(8, NaN), null);
});

// ============================================
// splitRuns
// ============================================

TestRunner.test('splitRuns: 纯 ASCII 单段', () => {
  const runs = CJKAlign.splitRuns('hello');
  TestRunner.assertEquals(runs.length, 1);
  TestRunner.assertEquals(runs[0].cjk, false);
  TestRunner.assertEquals(runs[0].text, 'hello');
});

TestRunner.test('splitRuns: 混合文本正确分段且拼接无损', () => {
  const src = '│ G1 工艺因果图    │';
  const runs = CJKAlign.splitRuns(src);
  const joined = runs.map(r => r.text).join('');
  TestRunner.assertEquals(joined, src);
  const cjkRuns = runs.filter(r => r.cjk);
  TestRunner.assertEquals(cjkRuns.length, 1);
  TestRunner.assertEquals(cjkRuns[0].text, '工艺因果图');
});

TestRunner.test('splitRuns: 线框图整行分段后列位可还原', () => {
  // 模拟线框图一行：每个 CJK 字符计 2 列，ASCII 计 1 列
  const line = '│ 输入: 对象(FOI) + 时间窗 + 现象/节点/问题类型';
  const runs = CJKAlign.splitRuns(line);
  let cols = 0;
  for (const r of runs) {
    cols += r.cjk ? r.text.length * 2 : r.text.length;
  }
  // 手算：'│ 输入: ' = 8 列 + '对象' 4 列 + '(FOI) + ' 8 列 + '时间窗' 6 列
  //      + ' + ' 3 列 + '现象' 4 列 + '/节点/问题类型' 中 CJK 6 字 12 列 + '/' 2 列
  TestRunner.assertEquals(cols, 8 + 4 + 8 + 6 + 3 + 4 + 12 + 2);
});

TestRunner.test('splitRuns: 空字符串返回空数组', () => {
  TestRunner.assertEquals(CJKAlign.splitRuns('').length, 0);
});

TestRunner.test('splitRuns: 连续调用不受 /g lastIndex 影响', () => {
  CJKAlign.splitRuns('中文');
  const runs = CJKAlign.splitRuns('中文');
  TestRunner.assertEquals(runs.length, 1);
  TestRunner.assertEquals(runs[0].text, '中文');
});

// ============================================
// pxToEm
// ============================================

TestRunner.test('pxToEm: px 补偿换算为 em', () => {
  TestRunner.assert(Math.abs(CJKAlign.pxToEm(2.8, 14) - 0.2) < 1e-9);
});

// ============================================
// computeFitFontSize
// ============================================

TestRunner.test('computeFitFontSize: 未超宽返回 null', () => {
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(500, 600, 14), null);
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(600, 600, 14), null);
});

TestRunner.test('computeFitFontSize: 超宽按比例缩小', () => {
  // 900 内容 / 600 容器 → 14 * 2/3 ≈ 9.33
  const size = CJKAlign.computeFitFontSize(900, 600, 14, 9);
  TestRunner.assert(Math.abs(size - 9.33) < 1e-9, `expected ~9.33, got ${size}`);
});

TestRunner.test('computeFitFontSize: 缩小后低于下限返回 null（保留滚动条）', () => {
  // 需要缩到 7px，低于 9px 下限
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(1200, 600, 14, 9), null);
});

TestRunner.test('computeFitFontSize: 恰好到下限可用', () => {
  // 14 * 9/14 = 9
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(1400, 900, 14, 9), 9);
});

TestRunner.test('computeFitFontSize: 非法输入返回 null', () => {
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(0, 600, 14), null);
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(900, 0, 14), null);
  TestRunner.assertEquals(CJKAlign.computeFitFontSize(900, 600, 0), null);
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
