#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * markdown-utils 段落模式单元测试
 *
 * 背景（2026-11-07 实机反馈）：伴学 AI 回答用 `<br><br>` 表示空行，
 * 一个空行 = 一整行行高，段落间距被放大到 ~54px。`paragraphs: true`
 * 把空行改成真正的 `<p>`，由 CSS 控制段距。
 *
 * Run: node tests/unit/test_markdown_utils_paragraphs.js
 */

const TestRunner = require('../shared/test-runner');

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

TestRunner.test('default mode keeps the legacy <br><br> paragraph break', () => {
  const html = markdownToHtml('a\n\nb');
  TestRunner.assert(html.includes('<br><br>'), 'default output must stay backward compatible');
  TestRunner.assert(!html.includes('<p>'), 'default output must not wrap paragraphs');
});

TestRunner.test('paragraphs mode turns blank lines into <p> blocks', () => {
  TestRunner.assertEquals(markdownToHtml('a\n\nb', { paragraphs: true }), '<p>a</p><p>b</p>');
});

TestRunner.test('single newlines stay inside one paragraph as <br>', () => {
  TestRunner.assertEquals(markdownToHtml('a\nb', { paragraphs: true }), '<p>a<br>b</p>');
});

TestRunner.test('headings are not wrapped in <p>', () => {
  TestRunner.assertEquals(
    markdownToHtml('## T\n\nbody', { paragraphs: true }),
    '<h2>T</h2><p>body</p>'
  );
});

TestRunner.test('list items lose the extra <br> and the list is not wrapped in <p>', () => {
  const html = markdownToHtml('- x\n- y', { paragraphs: true });
  TestRunner.assert(!html.includes('<br>'), 'no line break between list items');
  TestRunner.assert(!html.startsWith('<p>'), 'list must stay block-level');
  TestRunner.assert(html.includes('<li>x</li>'), 'list item content intact');
});

TestRunner.test('text before a list becomes a paragraph, list stays block-level', () => {
  const html = markdownToHtml('text\n\n- x\n- y', { paragraphs: true });
  TestRunner.assert(html.startsWith('<p>text</p>'), 'leading text should be a paragraph');
  TestRunner.assert(html.includes('<li>x</li>'), 'list survives');
});

TestRunner.test('code fences are not wrapped in <p>', () => {
  const html = markdownToHtml('```\ncode\n```\n\ntext', { paragraphs: true });
  TestRunner.assert(html.startsWith('<pre><code>code</code></pre>'), `code block should stay block-level, got: ${html}`);
  TestRunner.assert(html.endsWith('<p>text</p>'), 'following text should be a paragraph');
});

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
