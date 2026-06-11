#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Mermaid Source Replace
 * Pure function: replaceMermaidInSource(source, brokenCode, fixedCode)
 *
 * 红阶段：模块尚未实现，本文件应全部失败
 */

const TestRunner = require('../../shared/test-runner');
const { replaceMermaidInSource } = require('../../../dist/scripts/mermaid-source-replace');

// ============================================
// 基础替换
// ============================================

TestRunner.test('替换基础 mermaid 块', () => {
  const src = '前文\n```mermaid\ngraph TD\nA-->B\n```\n后文';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->B-->C');

  TestRunner.assertEquals(result.ok, true, '应成功');
  TestRunner.assert(result.newSource.includes('A-->B-->C'), '新代码应在 newSource 中');
  TestRunner.assert(!result.newSource.includes('A-->B\n```\n后文'), '旧代码块应被替换');
  TestRunner.assert(result.newSource.includes('前文'), '前文应保留');
  TestRunner.assert(result.newSource.includes('后文'), '后文应保留');
  TestRunner.assertEquals(result.replacements, 1, '替换 1 处');
});

TestRunner.test('保留 fence 缩进', () => {
  const src = '- 列表项\n  ```mermaid\n  graph TD\n  A-->B\n  ```\n- 下一项';
  // brokenCode 保留 2 空格缩进（与源内一致——这是 showMermaidFixUI 真实传出的形态）
  const result = replaceMermaidInSource(src, '  graph TD\n  A-->B', '  graph TD\n  A-->C');

  TestRunner.assertEquals(result.ok, true);
  TestRunner.assert(result.newSource.includes('  ```mermaid\n  graph TD\n  A-->C\n  ```'),
    '缩进应保留');
});

// ============================================
// normalize 空白容错
// ============================================

TestRunner.test('源文件中含多余空行仍能匹配', () => {
  const src = '```mermaid\n\ngraph TD\nA-->B\n\n```';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true, '多余空行应能匹配');
  TestRunner.assert(result.newSource.includes('A-->C'), '新代码应在 newSource 中');
});

TestRunner.test('Windows CRLF 换行仍能匹配', () => {
  const src = '```mermaid\r\ngraph TD\r\nA-->B\r\n```';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true, 'CRLF 应能匹配');
});

TestRunner.test('brokenCode 末尾含尾部空白仍能匹配', () => {
  const src = '```mermaid\ngraph TD\nA-->B\n```';
  const result = replaceMermaidInSource(src, '  graph TD\nA-->B  \n', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true, 'brokenCode 含尾部空白应能匹配');
});

// ============================================
// 多处匹配
// ============================================

TestRunner.test('多处匹配时仅替换第一处并返回 warning', () => {
  const src = '```mermaid\ngraph TD\nA-->B\n```\n中间\n```mermaid\ngraph TD\nA-->B\n```';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true);
  TestRunner.assertEquals(result.replacements, 1, '应只替换 1 处');
  TestRunner.assert(result.warning, '应返回 warning');
  TestRunner.assert(
    result.newSource.split('A-->C').length === 2,
    '应只出现 1 次 A-->C（不含 B）'
  );
});

// ============================================
// 找不到
// ============================================

TestRunner.test('源文件中未找到时返回 not_found', () => {
  const src = '```mermaid\ngraph TD\nX-->Y\n```';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, false);
  TestRunner.assertEquals(result.reason, 'not_found');
});

TestRunner.test('不在 mermaid fence 内的相同代码不被匹配', () => {
  // 防止 brokenCode 出现在普通代码块或正文中时被误匹配
  const src = '正文中有 graph TD\nA-->B\n```\n```mermaid\ngraph TD\nA-->B\n```';
  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true);
  // 只应替换 mermaid fence 内的，正文里的 graph TD 不动
  const mermaidMatch = result.newSource.match(/```mermaid\n([\s\S]*?)\n```/);
  TestRunner.assert(mermaidMatch, '应能找到 mermaid 块');
  TestRunner.assert(mermaidMatch[1].includes('A-->C'), 'mermaid 块内应被替换');
});

// ============================================
// 入参校验
// ============================================

TestRunner.test('空 source 返回错误', () => {
  const result = replaceMermaidInSource('', 'graph TD\nA-->B', 'graph TD\nA-->C');
  TestRunner.assertEquals(result.ok, false);
  TestRunner.assertEquals(result.reason, 'empty');
});

TestRunner.test('空 brokenCode 返回错误', () => {
  const result = replaceMermaidInSource('```mermaid\ngraph TD\nA-->B\n```', '', 'graph TD\nA-->C');
  TestRunner.assertEquals(result.ok, false);
  TestRunner.assertEquals(result.reason, 'empty');
});

TestRunner.test('空 fixedCode 仍能替换（清空 mermaid 内容）', () => {
  const result = replaceMermaidInSource(
    '```mermaid\ngraph TD\nA-->B\n```',
    'graph TD\nA-->B',
    ''
  );
  TestRunner.assertEquals(result.ok, true);
  TestRunner.assertEquals(result.replacements, 1);
});

// ============================================
// 复杂源码场景
// ============================================

TestRunner.test('源码含多个 mermaid 块，只替换目标', () => {
  const src = [
    '```mermaid',
    'graph LR',
    'X-->Y',
    '```',
    '',
    '中间文字',
    '',
    '```mermaid',
    'graph TD',
    'A-->B',
    '```',
    '',
    '```mermaid',
    'graph RL',
    'M-->N',
    '```'
  ].join('\n');

  const result = replaceMermaidInSource(src, 'graph TD\nA-->B', 'graph TD\nA-->C');

  TestRunner.assertEquals(result.ok, true);
  TestRunner.assert(result.newSource.includes('graph LR\nX-->Y'), '第一个块不变');
  TestRunner.assert(result.newSource.includes('graph TD\nA-->C'), '目标块被替换');
  TestRunner.assert(result.newSource.includes('graph RL\nM-->N'), '第三个块不变');
});

TestRunner.run();
