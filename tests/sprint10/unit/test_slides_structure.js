#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for slides structure split (v3)
 * 源码层只做结构切分：显式 --- 硬边界 / 自动模式 H1 分章，
 * 分页装箱由 slides-pack-core（DOM 测量）负责，不在此层测试。
 */

const TestRunner = require('../../shared/test-runner');
const { parseMarkdownStructure } = require('../../shared/slides-splitter');

const runner = TestRunner;

runner.test('自动模式：H1 分章 + 封面，章节内容完整保留', () => {
  const md = [
    '# 第一章', '',
    '## 1.1 背景', '内容A', '',
    '## 1.2 方法', '内容B', '',
    '# 第二章', '',
    '## 2.1 结果', '内容C'
  ].join('\n');
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 2, '应有 2 章');
  runner.assertEquals(groups[0].cover, '# 第一章');
  runner.assertEquals(groups[0].units.length, 1, '每章一个内容单元');
  runner.assert(groups[0].units[0].includes('## 1.1 背景') && groups[0].units[0].includes('## 1.2 方法'),
    'H2 标题应保留在内容单元内（供 DOM 层渲染与续页跟踪）');
  runner.assertEquals(groups[1].cover, '# 第二章');
  runner.assert(groups[1].units[0].includes('2.1 结果'));
});

runner.test('自动模式：首个标题前的内容成为无封面章节', () => {
  const md = '前言文字\n\n# 第一章\n\n正文';
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 2);
  runner.assertEquals(groups[0].cover, null, '前言章无封面');
  runner.assert(groups[0].units[0].includes('前言文字'));
});

runner.test('自动模式：代码围栏内的 # 不分章', () => {
  const md = '# 第一章\n\n```python\n# 注释不是标题\n```\n\n正文';
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 1, '围栏内的 # 不应分章');
});

runner.test('自动模式：YAML frontmatter 跳过', () => {
  const md = '---\ntitle: test\n---\n\n# 第一章\n\n正文';
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 1);
  runner.assertEquals(groups[0].cover, '# 第一章');
  runner.assert(!groups[0].units[0].includes('title:'), 'YAML 内容不应进入单元');
});

runner.test('显式模式：--- 分横页组，-- 分纵页单元', () => {
  const md = '第一页\n\n---\n\n第二页\n\n--\n\n第二页下';
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 2, '--- 应分 2 组');
  runner.assertEquals(groups[0].cover, null);
  runner.assertEquals(groups[1].units.length, 2, '-- 应分 2 个纵页单元');
  runner.assert(groups[1].units[0].includes('第二页'));
  runner.assert(groups[1].units[1].includes('第二页下'));
});

runner.test('显式模式：Setext 标题（文本+---）不误判为分隔符', () => {
  const md = '# 第一章\n\n这是一个标题\n---\n\n## 小节\n\n内容';
  const groups = parseMarkdownStructure(md);
  // setext 的 --- 前不是空行 → 走自动模式，全文一章
  runner.assertEquals(groups.length, 1, 'Setext 不应触发显式模式');
});

runner.test('显式模式：--- 在代码围栏内不生效', () => {
  const md = '第一页\n\n```\n---\n```\n\n---\n\n第二页';
  const groups = parseMarkdownStructure(md);
  runner.assertEquals(groups.length, 2, '围栏外的 --- 生效');
  runner.assert(groups[0].units[0].includes('```'), '围栏内容完整');
});

runner.run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
