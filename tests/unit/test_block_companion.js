#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD: block-level AI companion pure layer (Sprint 34).
 *
 * Module under test: dist/scripts/learning/block-companion.js
 * 块源码从 tab.content 按「类型序号」回抽；DOM 只负责挂入口。
 */

const TestRunner = require('../shared/test-runner');
const BlockCompanion = require('../../dist/scripts/learning/block-companion');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

// ============================================
// extractTableBlocks
// ============================================

test('extractTableBlocks 抽取多张表格并跳过代码围栏', () => {
  const md = [
    '# 章节',
    '',
    '| 概念 | 含义 |',
    '| --- | --- |',
    '| 界面 | 固液交界 |',
    '',
    '```js',
    '| 这不是 | 表格 |',
    '| --- | --- |',
    '```',
    '',
    '| 参数 | 单位 |',
    '|:--|--:|',
    '| 温度 | K |'
  ].join('\n');
  const tables = BlockCompanion.extractTableBlocks(md);
  assertEquals(tables.length, 2, '两张表格');
  assert(tables[0].text.includes('概念'), '第一张表头');
  assert(tables[1].text.includes('参数'), '第二张表头');
  assert(!tables.some((t) => t.text.includes('这不是')), '代码围栏内的管道文本不算表格');
});

test('extractTableBlocks 支持引用块内表格', () => {
  const md = [
    '> 引言',
    '> | 项 | 值 |',
    '> | --- | --- |',
    '> | 坩埚 | 石英 |',
    '',
    '结尾'
  ].join('\n');
  const tables = BlockCompanion.extractTableBlocks(md);
  assertEquals(tables.length, 1, '引用块表格');
  assert(tables[0].text.includes('坩埚'), '单元格内容');
});

test('extractTableBlocks 容忍 CRLF 与无外侧管道', () => {
  const md = 'A | B\r\n--- | ---\r\n1 | 2\r\n';
  const tables = BlockCompanion.extractTableBlocks(md);
  assertEquals(tables.length, 1, 'CRLF 表格');
  assert(tables[0].text.includes('A | B'), '保留原始行');
});

test('extractTableBlocks 不把普通段落里的管道当表格', () => {
  const md = 'a | b 只是文本\n没有分隔行\n';
  assertEquals(BlockCompanion.extractTableBlocks(md).length, 0, '无分隔行');
});

test('extractTableBlocks 记录起止行号', () => {
  const md = ['前文', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '后文'].join('\n');
  const [table] = BlockCompanion.extractTableBlocks(md);
  assertEquals(table.startLine, 2, '起始行');
  assertEquals(table.endLine, 4, '结束行');
});

// ============================================
// extractMermaidBlocks
// ============================================

test('extractMermaidBlocks 支持 ``` 与 ~~~ 围栏', () => {
  const md = [
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    '',
    '~~~mmd',
    'sequenceDiagram',
    '  A->>B: hi',
    '~~~'
  ].join('\n');
  const blocks = BlockCompanion.extractMermaidBlocks(md);
  assertEquals(blocks.length, 2, '两张图');
  assertEquals(blocks[0].text, 'graph TD\n  A --> B', '第一张源码');
  assertEquals(blocks[1].text, 'sequenceDiagram\n  A->>B: hi', '第二张源码');
});

test('extractMermaidBlocks 大小写与尾随 info 容忍', () => {
  const md = '```Mermaid align=center\ngraph LR\nA-->B\n```';
  const blocks = BlockCompanion.extractMermaidBlocks(md);
  assertEquals(blocks.length, 1, '大小写不敏感');
  assert(blocks[0].text.startsWith('graph LR'), '保留源码');
});

test('extractMermaidBlocks 不匹配普通代码围栏', () => {
  const md = '```js\nconst a = 1;\n```\n';
  assertEquals(BlockCompanion.extractMermaidBlocks(md).length, 0, '普通代码围栏');
});

test('extractMermaidBlocks 去掉公共缩进', () => {
  const md = '```mermaid\n    graph TD\n      A --> B\n```';
  const [block] = BlockCompanion.extractMermaidBlocks(md);
  assertEquals(block.text, 'graph TD\n  A --> B', 'dedent');
});

// ============================================
// pickBlockSource
// ============================================

test('pickBlockSource 按类型与序号取源码', () => {
  const md = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\ngraph LR\nC-->D\n```';
  assertEquals(
    BlockCompanion.pickBlockSource('mermaid', 1, md),
    'graph LR\nC-->D',
    '第二张 mermaid'
  );
});

test('pickBlockSource 越界返回 null', () => {
  const md = '```mermaid\ngraph TD\nA-->B\n```';
  assertEquals(BlockCompanion.pickBlockSource('mermaid', 3, md), null, '越界');
  assertEquals(BlockCompanion.pickBlockSource('unknown', 0, md), null, '未知类型');
});

test('pickBlockSource 可注入自定义提取器', () => {
  const extractors = {
    table: () => [{ text: 'T0' }, { text: 'T1' }]
  };
  assertEquals(BlockCompanion.pickBlockSource('table', 0, '', extractors), 'T0', '注入提取器');
});

test('pickBlockSource 用真实 SVG 提取器', () => {
  const md = [
    '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    '',
    '<svg viewBox="0 0 20 20"><circle r="5"/></svg>'
  ].join('\n');
  const picked = BlockCompanion.pickBlockSource('svg', 1, md);
  assert(picked && picked.includes('circle'), '第二个内联 svg');
});

// ============================================
// 身份与裁剪
// ============================================

test('blockLabel 使用从 1 开始的序号', () => {
  assertEquals(BlockCompanion.blockLabel('mermaid', 1), 'Mermaid 图 #2', 'mermaid');
  assertEquals(BlockCompanion.blockLabel('table', 0), '表格 #1', 'table');
  assertEquals(BlockCompanion.blockLabel('svg', 4), 'SVG 示意图 #5', 'svg');
});

test('buildBlockKey 取章节 stem 并归一化路径', () => {
  assertEquals(
    BlockCompanion.buildBlockKey('chapters/04-wave.md', 'mermaid', 1),
    'block::04-wave::mermaid::2',
    '正斜杠'
  );
  assertEquals(
    BlockCompanion.buildBlockKey('C:\\course\\05-optics.md', 'table', 0),
    'block::05-optics::table::1',
    '反斜杠'
  );
  assertEquals(
    BlockCompanion.buildBlockKey('', 'svg', 0),
    'block::chapter::svg::1',
    '空章节名兜底'
  );
});

test('truncateSource 短文本原样返回', () => {
  assertEquals(BlockCompanion.truncateSource('short', 100), 'short', '不截断');
});

test('truncateSource 长文本保留头尾并标注截断', () => {
  const src = 'H'.repeat(1000) + 'M'.repeat(1000) + 'T'.repeat(1000);
  const out = BlockCompanion.truncateSource(src, 1200);
  assert(out.includes('已截断'), '标记');
  assert(out.startsWith('H'), '保留头部');
  assert(out.endsWith('T'), '保留尾部');
  assert(out.length <= 1300, `长度受控: ${out.length}`);
});

test('truncateSource 处理空值', () => {
  assertEquals(BlockCompanion.truncateSource('', 100), '', '空字符串');
  assertEquals(BlockCompanion.truncateSource(null, 100), '', 'null');
});

// ============================================
// 运行
// ============================================

TestRunner.run().then(({ failed }) => {
  if (failed > 0) process.exit(1);
});
