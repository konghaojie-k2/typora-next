#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for export-svg-blocks（Word 导出内联 <svg> → 图片）
 *
 * 纯 Node 环境（无 DOM）：extract / dedent / rewrite 走纯逻辑，
 * measureSvg 走 viewBox/属性兜底分支。
 */

const TestRunner = require('../shared/test-runner');
const ExportSvgBlocks = require('../../dist/scripts/export-svg-blocks.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const SVG = '<svg viewBox="0 0 120 60"><circle cx="60" cy="30" r="20" fill="red"/></svg>';
const SVG_MULTILINE = [
  '<svg viewBox="0 0 100 50">',
  '  <rect x="5" y="5" width="90" height="40"/>',
  '</svg>'
].join('\n');

// ---------- extractInlineSvgBlocks ----------

test('提取普通内联 svg（单行）', () => {
  const md = '# 标题\n\n' + SVG + '\n\n正文';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG);
  assertEquals(blocks[0].startLine, 2);
  assertEquals(blocks[0].endLine, 2);
});

test('提取多行 svg 块', () => {
  const md = '前文\n' + SVG_MULTILINE + '\n后文';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG_MULTILINE);
  assertEquals(blocks[0].startLine, 1);
  assertEquals(blocks[0].endLine, 3);
});

test('代码围栏内的 svg 不提取', () => {
  const md = '```html\n' + SVG + '\n```\n\n' + SVG_MULTILINE;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1, 'fence 内的 svg 必须忽略');
  assertEquals(blocks[0].text, SVG_MULTILINE);
});

test('~~~ 围栏内的 svg 不提取', () => {
  const md = '~~~\n' + SVG + '\n~~~\n' + SVG;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].startLine, 3, '只取围栏外那个');
});

test('多个 svg 各自成块', () => {
  const md = SVG + '\n中间\n' + SVG_MULTILINE;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 2);
});

test('CRLF 归一化', () => {
  const md = 'a\r\n' + SVG + '\r\nb';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG);
});

// ---------- prepareForWordExport：重写 + key ----------

test('svg 原位重写为 mermaid 围栏', async () => {
  const md = '前文\n\n' + SVG + '\n\n后文';
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  const lines = out.markdown.split('\n');
  assertEquals(lines[2], '```mermaid');
  assertEquals(lines[3], SVG);
  assertEquals(lines[4], '```');
  assertEquals(lines[0], '前文');
  assertEquals(lines[6], '后文');
});

test('两个相同 svg 各自成围栏（防 replace-first-occurrence 双重包裹）', async () => {
  const md = SVG + '\n\n' + SVG;
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  const count = out.markdown.split('```mermaid').length - 1;
  assertEquals(count, 2, '两次出现都必须各自包一层围栏');
  // 围栏内不得再出现围栏标记
  assert(out.markdown.indexOf('```mermaid\n```mermaid') === -1, '不得嵌套');
});

test('key 与 findMermaidBlocks 归一化一致（dedent+trim）', async () => {
  const indented = SVG_MULTILINE.split('\n').map(l => '  ' + l).join('\n');
  const md = 'x\n' + indented;
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  assertEquals(out.images.length, 1);
  assertEquals(out.images[0].key, SVG_MULTILINE, '缩进应被 dedent 掉');
});

test('无 svg 时原样返回', async () => {
  const md = '# 没有图\n\n正文';
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  assertEquals(out.markdown, md);
  assertEquals(out.images.length, 0);
});

// ---------- measureSvg（无 DOM → 属性兜底分支） ----------

test('缺 xmlns 时自动补（usvg 必需）', async () => {
  const r = await ExportSvgBlocks.measureSvg(SVG);
  assert(r.svg.includes('xmlns="http://www.w3.org/2000/svg"'), '应注入 xmlns');
  assert(!/<svg[^>]*\sxmlns=.*\sxmlns=/.test(r.svg), '不得重复注入');
});

test('已有 xmlns 不重复注入，viewBox 提供尺寸', async () => {
  const withNs = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>';
  const r = await ExportSvgBlocks.measureSvg(withNs);
  assertEquals((r.svg.match(/xmlns=/g) || []).length, 1);
  assertEquals(r.width, 200);
  assertEquals(r.height, 100);
});

test('无 viewBox 无尺寸时回退默认尺寸', async () => {
  const r = await ExportSvgBlocks.measureSvg('<svg><rect/></svg>');
  assertEquals(r.width, 600);
  assertEquals(r.height, 400);
});

// ---------- 集成接线（防回归） ----------

test('index.html 引入 export-svg-blocks.js 且在 main.js 之前', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../dist/index.html'), 'utf-8');
  const svgPos = html.indexOf('scripts/export-svg-blocks.js');
  const mainPos = html.indexOf('scripts/main.js');
  assert(svgPos > 0, '缺少 script 标签');
  assert(svgPos < mainPos, '必须先于 main.js 加载');
});

test('main.js 集成 prepareForWordExport', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('ExportSvgBlocks.prepareForWordExport'), 'exportWord 未接 svg 预处理');
  assert(src.includes('markdown: exportMarkdown'), 'invoke 应使用重写后的 markdown');
  // mermaid 渲染循环必须基于原始 markdown（合成围栏不可进入 mermaid 解析）
  assert(/findMermaidBlocks\(tab\.content\)/.test(src), 'mermaidBlocks 应来自原始 markdown');
});

TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
