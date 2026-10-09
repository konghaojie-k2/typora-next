#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * 聊天气泡 SVG 渲染通道单元测试（markdown-utils.js）
 *
 * 背景：AI 伴学「🖼️ 画个图」的回答带 ```svg 围栏示意图。气泡渲染器
 * escape 一切 HTML 是安全底线，因此 SVG 走与 math/code 同款的
 * 「提取占位 → 管线 → 还原」通道，还原前剥除危险内容：
 * <script>、on* 事件属性（SVG onload 是经典 XSS 向量）、
 * <foreignObject>（可内嵌任意 HTML 绕过 escape）。
 *
 * Run: node tests/unit/test_markdown_utils_svg.js
 */

const TestRunner = require('../shared/test-runner');

// DOM/window mock 必须在 require 之前（同 test_markdown_utils_math.js）
global.window = global.window || {};
global.document = {
  createElement: () => {
    const el = {};
    let html = '';
    Object.defineProperty(el, 'textContent', {
      set(v) {
        html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    });
    Object.defineProperty(el, 'innerHTML', { get: () => html });
    return el;
  }
};

const { markdownToHtml } = require('../../dist/scripts/markdown-utils');

const SIMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120" width="100%">' +
  '<title>晶面示意</title>' +
  '<rect x="0" y="0" width="680" height="120" fill="#F7F5F0"/>' +
  '</svg>';

// ============================================
// 基本渲染：围栏 → 活图
// ============================================

TestRunner.test('svg fence renders as live markup, not a code block', () => {
  const html = markdownToHtml('看图：\n```svg\n' + SIMPLE_SVG + '\n```\n完毕');
  TestRunner.assert(html.includes('<svg'), `live svg missing, got: ${html}`);
  TestRunner.assert(!html.includes('&lt;svg'), `svg must not be escaped, got: ${html}`);
  TestRunner.assert(!html.includes('<pre><code>'), `svg fence must not become a code block, got: ${html}`);
});

TestRunner.test('svg legit content is preserved verbatim', () => {
  const html = markdownToHtml('```svg\n' + SIMPLE_SVG + '\n```');
  TestRunner.assert(html.includes('viewBox="0 0 680 120"'), `viewBox lost: ${html}`);
  TestRunner.assert(html.includes('<title>晶面示意</title>'), `title lost: ${html}`);
  TestRunner.assert(html.includes('fill="#F7F5F0"'), `fill lost: ${html}`);
});

TestRunner.test('text around the svg fence survives', () => {
  const html = markdownToHtml('前文引入。\n```svg\n' + SIMPLE_SVG + '\n```\n图后正文。');
  TestRunner.assert(html.includes('前文引入。'), `leading text lost: ${html}`);
  TestRunner.assert(html.includes('图后正文。'), `trailing text lost: ${html}`);
});

// ============================================
// 危险内容清洗
// ============================================

TestRunner.test('<script> inside svg is stripped', () => {
  const html = markdownToHtml('```svg\n<svg><rect width="10" height="10"/><script>alert(1)</script></svg>\n```');
  TestRunner.assert(!/<script/i.test(html), `script survived: ${html}`);
  TestRunner.assert(!/alert\(1\)/.test(html), `script body survived: ${html}`);
  TestRunner.assert(html.includes('<rect'), `legit rect lost: ${html}`);
});

TestRunner.test('on* event handler attributes are stripped (svg onload XSS)', () => {
  const html = markdownToHtml('```svg\n<svg onload="alert(1)"><rect onclick="alert(2)" width="10" height="10"/></svg>\n```');
  TestRunner.assert(!/onload/i.test(html), `onload survived: ${html}`);
  TestRunner.assert(!/onclick/i.test(html), `onclick survived: ${html}`);
  TestRunner.assert(html.includes('width="10"'), `legit attributes lost: ${html}`);
});

TestRunner.test("on* attributes with single quotes and unquoted values are stripped", () => {
  const html = markdownToHtml("```svg\n<svg onload='alert(1)' onfocus=alert(2)><rect width=\"10\" height=\"10\"/></svg>\n```");
  TestRunner.assert(!/onload/i.test(html), `single-quoted onload survived: ${html}`);
  TestRunner.assert(!/onfocus/i.test(html), `unquoted onfocus survived: ${html}`);
});

TestRunner.test('<foreignObject> is stripped (embeds arbitrary HTML bypassing escape)', () => {
  const html = markdownToHtml(
    '```svg\n<svg><rect width="10" height="10"/>' +
    '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"></body></foreignObject>' +
    '</svg>\n```'
  );
  TestRunner.assert(!/<foreignObject/i.test(html), `foreignObject survived: ${html}`);
  TestRunner.assert(!/onerror/i.test(html), `payload inside foreignObject survived: ${html}`);
  TestRunner.assert(html.includes('<rect'), `legit rect lost: ${html}`);
});

// ============================================
// 与既有通道共存
// ============================================

TestRunner.test('regular code blocks are unaffected by the svg channel', () => {
  const html = markdownToHtml('```js\nconst a = 1 < 2;\n```');
  TestRunner.assert(html.includes('<pre><code>'), `js fence should stay a code block, got: ${html}`);
  TestRunner.assert(html.includes('const a = 1 &lt; 2;'), `code content should be escaped, got: ${html}`);
});

TestRunner.test('svg fence and code fence coexist', () => {
  const html = markdownToHtml('```svg\n' + SIMPLE_SVG + '\n```\n代码：\n```js\nlet x = 1;\n```');
  TestRunner.assert(html.includes('<svg'), `svg lost in mixed content: ${html}`);
  TestRunner.assert(html.includes('<pre><code>'), `code block lost in mixed content: ${html}`);
});

TestRunner.test('math inside svg text is not extracted (placeholder protects it)', () => {
  // svg 先于 math 提取，围栏内的 $ 不应触发 KaTeX 占位
  const html = markdownToHtml('```svg\n<svg><text x="10" y="10" fill="#333">$x^2$</text></svg>\n```');
  TestRunner.assert(html.includes('$x^2$'), `svg text content lost: ${html}`);
  TestRunner.assert(!html.includes('%%CHATMATH'), `math placeholder leaked: ${html}`);
});

TestRunner.test('svg fence tag is case-insensitive', () => {
  const html = markdownToHtml('```SVG\n' + SIMPLE_SVG + '\n```');
  TestRunner.assert(html.includes('<svg'), `uppercase SVG fence not recognized: ${html}`);
});

// ============================================
// 边界
// ============================================

TestRunner.test('unclosed svg fence stays literal (no crash, no half-render)', () => {
  const html = markdownToHtml('前文\n```svg\n<svg><rect width="10" height="10"/></svg>');
  TestRunner.assert(!html.includes('<svg'), `unclosed fence must not render live svg, got: ${html}`);
  TestRunner.assert(html.includes('前文'), `text lost: ${html}`);
});

TestRunner.test('multiple svg fences in one answer all render', () => {
  const html = markdownToHtml('```svg\n<svg><rect width="10" height="10"/></svg>\n```\n中间\n```svg\n<svg><circle r="5"/></svg>\n```');
  TestRunner.assert(html.includes('<rect'), `first svg lost: ${html}`);
  TestRunner.assert(html.includes('<circle'), `second svg lost: ${html}`);
  TestRunner.assert(html.includes('中间'), `middle text lost: ${html}`);
});

TestRunner.test('no svg placeholder leaks into output', () => {
  const html = markdownToHtml('```svg\n' + SIMPLE_SVG + '\n```');
  TestRunner.assert(!html.includes('%%CHATSVG'), `svg placeholder leaked: ${html}`);
});

// ============================================
// 完成
// ============================================

TestRunner.run().then(({ failed }) => {
  if (failed > 0) process.exit(1);
});
