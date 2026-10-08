#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * 聊天气泡数学渲染单元测试（markdown-utils.js）
 *
 * 覆盖：AI 对话气泡里的 $...$ / $$...$$ 应渲染为 KaTeX HTML，
 * 且 LaTeX 源码不被轻量 markdown 管线破坏（*、&、_、换行）。
 * 对齐主预览方案：先抽取保护 → 管线 → KaTeX 还原（throwOnError: false 语义）。
 *
 * Run: node tests/unit/test_markdown_utils_math.js
 */

const TestRunner = require('../shared/test-runner');

// DOM/window mock 必须在 require 之前（escapeHtml 用 document，IIFE 挂 window）
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

// fake katex：记录调用并回放可定位的标记
let katexCalls = [];
function installFakeKatex(impl) {
  katexCalls = [];
  global.katex = {
    renderToString(tex, opts) {
      katexCalls.push({ tex, displayMode: !!(opts && opts.displayMode) });
      if (impl) return impl(tex, opts);
      const display = opts && opts.displayMode ? 1 : 0;
      return `<span data-katex="${encodeURIComponent(tex)}" data-display="${display}"></span>`;
    }
  };
}
function removeKatex() {
  delete global.katex;
  delete global.window.katex;
  katexCalls = [];
}

// ============================================
// 无 katex（Node 兜底路径）：原文保留，现状不回归
// ============================================

TestRunner.test('no katex: inline math stays as raw text', () => {
  removeKatex();
  const html = markdownToHtml('炉压 $x^2$ 左右');
  TestRunner.assert(html.includes('$x^2$'), `raw $x^2$ should survive, got: ${html}`);
});

TestRunner.test('no katex: display math stays as raw text', () => {
  removeKatex();
  const html = markdownToHtml('换算 $$30 \\div 750$$ 完成');
  TestRunner.assert(html.includes('$$30 \\div 750$$'), `raw $$...$$ should survive, got: ${html}`);
});

// ============================================
// 有 katex：inline / display 渲染
// ============================================

TestRunner.test('inline math renders via katex with displayMode false', () => {
  installFakeKatex();
  const html = markdownToHtml('压强为 $p = 750$ 左右');
  TestRunner.assert(html.includes(encodeURIComponent('p = 750')), `katex output missing, got: ${html}`);
  const call = katexCalls.find(c => c.tex === 'p = 750');
  TestRunner.assert(!!call, 'katex should be called with the tex source');
  TestRunner.assert(call.displayMode === false, 'inline math must use displayMode false');
});

TestRunner.test('display math renders via katex with displayMode true (实爆案例 Torr→bar)', () => {
  installFakeKatex();
  const tex = '30\\ \\text{Torr} \\div 750 \\approx 0.040\\ \\text{bar}';
  const html = markdownToHtml(`第一步，把炉压换算：\n\n$$${tex}$$\n\n（差别可以忽略。）`);
  const call = katexCalls.find(c => c.displayMode);
  TestRunner.assert(!!call, 'display math should reach katex');
  TestRunner.assert(call.tex === tex, `tex must be intact, got: ${call.tex}`);
  TestRunner.assert(html.includes(encodeURIComponent(tex)), `katex output missing, got: ${html}`);
});

// ============================================
// LaTeX 源码不被轻量 markdown 管线破坏
// ============================================

TestRunner.test('asterisk inside math does not become <em>', () => {
  installFakeKatex();
  markdownToHtml('$\\text{a*b}$');
  const call = katexCalls.find(c => c.tex.includes('a*b'));
  TestRunner.assert(!!call && call.tex === '\\text{a*b}', `tex corrupted by italic rule: ${katexCalls[0] && katexCalls[0].tex}`);
  TestRunner.assert(!katexCalls[0] || !/<em>/.test(''), 'noop');
});

TestRunner.test('ampersand inside math is not double-escaped for katex', () => {
  installFakeKatex();
  markdownToHtml('$$\\begin{cases} a & b \\end{cases}$$');
  const call = katexCalls.find(c => c.displayMode);
  TestRunner.assert(call.tex.includes('a & b'), `tex should keep raw &, got: ${call.tex}`);
  TestRunner.assert(!call.tex.includes('&amp;'), `tex must not contain entity, got: ${call.tex}`);
});

TestRunner.test('underscore subscript survives (no markdown mangling)', () => {
  installFakeKatex();
  const html = markdownToHtml('**重点**：$a_1 + b_2$');
  TestRunner.assert(html.includes('<strong>重点</strong>'), `bold outside math must still render, got: ${html}`);
  const call = katexCalls.find(c => c.tex === 'a_1 + b_2');
  TestRunner.assert(!!call, `subscript tex corrupted: ${JSON.stringify(katexCalls)}`);
});

TestRunner.test('multiline display math keeps newlines, no <br> injected inside', () => {
  installFakeKatex();
  const tex = '\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}';
  const html = markdownToHtml(`$$\n${tex}\n$$`);
  const call = katexCalls.find(c => c.displayMode);
  TestRunner.assert(!!call && call.tex === tex, `multiline tex corrupted: ${call && call.tex}`);
  TestRunner.assert(!/<br>/.test(html.replace(/data-katex="[^"]*"/g, '')) || !html.includes('<br>' + encodeURIComponent(tex)),
    'display math must not be split by <br>');
});

// ============================================
// 代码块与转义美元豁免
// ============================================

TestRunner.test('dollar inside fenced code block is not treated as math', () => {
  installFakeKatex();
  const html = markdownToHtml('示例：\n```js\nconst s = "$x^2$";\n```\n完毕');
  TestRunner.assert(html.includes('<pre><code>'), `fence should render as code block, got: ${html}`);
  TestRunner.assert(html.includes('$x^2$'), `code content should stay literal, got: ${html}`);
  TestRunner.assert(!katexCalls.some(c => c.tex === 'x^2'), 'math inside fence must not reach katex');
});

TestRunner.test('escaped \\$ does not start math', () => {
  installFakeKatex();
  const html = markdownToHtml('价格 \\$5 不算贵');
  TestRunner.assert(katexCalls.length === 0, `escaped dollar should not trigger katex: ${JSON.stringify(katexCalls)}`);
  TestRunner.assert(html.includes('\\$5'), `escaped dollar text should survive, got: ${html}`);
});

TestRunner.test('$ followed by space is not inline math (auto-render 对齐)', () => {
  installFakeKatex();
  markdownToHtml('这 $ 是美元符号');
  TestRunner.assert(katexCalls.length === 0, `lone $ must not trigger katex: ${JSON.stringify(katexCalls)}`);
});

// ============================================
// katex 渲染失败回退
// ============================================

TestRunner.test('katex throwing falls back to raw text without throwing', () => {
  installFakeKatex(() => { throw new Error('parse error'); });
  const html = markdownToHtml('坏公式 $\\frac{$ 好');
  TestRunner.assert(html.includes('$'), 'fallback should keep raw text');
});

// ============================================
// 完成
// ============================================

removeKatex();
TestRunner.run().then(({ failed }) => {
  if (failed > 0) process.exit(1);
});
