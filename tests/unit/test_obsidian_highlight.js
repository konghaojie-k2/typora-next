#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Obsidian ==highlight== 跨内联元素高亮
 *
 * 背景（2026-11-05 实爆）：==🔴**密闭不可侵入…**== 未渲染成 <mark>。
 * 原因：pulldown-cmark 先把 **bold** 变成 <strong>，replaceInTextNodes
 * 逐“单个文本节点”跑正则 —— 开头 ==🔴 与结尾 == 落在不同节点，配不上对。
 *
 * 纯逻辑测试 matchHighlightInText（节点拼接串上的 ==..== 匹配）。
 * DOM 组装（observeHighlight 函数）走 slides/main 源码级断言。
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('../shared/test-runner');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

// 先从 main.js 提取纯函数（红：模块尚不存在）
let matchHighlightInText;
try {
  matchHighlightInText = require('../../dist/scripts/obsidian-highlight.js').matchHighlightInText;
} catch (e) {
  matchHighlightInText = null;
}

// ---------- 纯逻辑 ----------

test('纯文本：简单高亮', () => {
  assert(matchHighlightInText, 'obsidian-highlight.js 模块不存在');
  const r = matchHighlightInText('前文 ==简单高亮== 后文');
  assert(r, '必须命中');
  assertEquals(r.innerText, '简单高亮');
  assertEquals(r.outerStart, 3);
  assertEquals(r.outerEnd, r.outerStart + '==简单高亮=='.length);
  assertEquals(r.innerStart, r.outerStart + 2);
  assertEquals(r.innerEnd, r.outerEnd - 2);
});

test('跨内联元素拼接串：==🔴**bold**==（首节点 ==🔴，尾节点 ==）', () => {
  const r = matchHighlightInText('==🔴**密闭不可侵入**==');
  assert(r, '必须命中');
  assertEquals(r.outerStart, 0);
  assertEquals(r.innerStart, 2);
  assertEquals(r.innerText, '🔴**密闭不可侵入**');
  assertEquals(r.innerEnd, 2 + '🔴**密闭不可侵入**'.length);
});

test('多组高亮：找第一组', () => {
  const r = matchHighlightInText('==a== 中间 ==b==');
  assert(r);
  assertEquals(r.innerText, 'a');
});

test('== 开头空格违规', () => {
  assertEquals(matchHighlightInText('== 高亮空格 =='), null);
});

test('== 结尾空格不违规（==开头空格 高亮== → 包全串）', () => {
  // 语义：Obsidian 只要求高亮内部不能以空白开头；结尾空格是合法的
  const r = matchHighlightInText('==开头空格 高亮==');
  assert(r, '结尾空格允许');
  assertEquals(r.innerText, '开头空格 高亮');
});

test('反例：===（三等于）不算高亮', () => {
  assertEquals(matchHighlightInText('a === b'), null);
  assertEquals(matchHighlightInText('===='), null);
});

test('== 内部含 == 全部拒配（歧义场景）', () => {
  // ==a ==b== c==：第一组开 == 后 inner='a ' 结尾空格违规 → 跳过；
  // 第二组开 == 后是空格 → 跳过；最终全部拒配，保持纯文本原样
  assertEquals(matchHighlightInText('==a ==b== c=='), null);
});

test('反例：无闭合 ==', () => {
  assertEquals(matchHighlightInText('==开头'), null);
  assertEquals(matchHighlightInText('无标记'), null);
});

test('反例：空内容（==== 即空内容）不算', () => {
  assertEquals(matchHighlightInText('===='), null);
});

// ---------- 源码级布线断言 ----------

test('obsidian-highlight.js 导出 observeHighlight + markElement 供 main/slides 复用', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/obsidian-highlight.js'), 'utf-8');
  assert(/function observeHighlight|const observeHighlight|observeHighlight = function/.test(src),
    '必须导出 observeHighlight');
  assert(/function markElement|const markElement|markElement = function/.test(src),
    '必须导出 markElement');
});

test('main.js 集成：initObsidianHighlight 替换为跨节点版本', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('ObsidianHighlight.observeHighlight'),
    'main.js 必须调用 ObsidianHighlight.observeHighlight');
  assert(!src.includes('/==([^=\\s][^=]*|[^=\\s])==/g'),
    '旧的单文本节点正则必须移除');
});

test('slides.js 集成：measureAndPack 调用 observeHighlight', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  const idx = src.indexOf('ObsidianHighlight.observeHighlight(div)');
  const measureIdx = src.indexOf('var items = measureItems(div)');
  assert(idx !== -1, 'measureAndPack 必须调用 observeHighlight(div)');
  assert(idx < measureIdx, '高亮包装必须在测量之前（mark 元素可被装箱/拆分）');
});

test('index.html / slides.html 集成：加载 obsidian-highlight.js', () => {
  const idx = fs.readFileSync(
    path.join(__dirname, '../../dist/index.html'), 'utf-8');
  assert(idx.includes('obsidian-highlight.js'), 'index.html 必须加载模块');
  const sl = fs.readFileSync(
    path.join(__dirname, '../../dist/slides.html'), 'utf-8');
  assert(sl.includes('obsidian-highlight.js'), 'slides.html 必须加载模块');
});

TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
