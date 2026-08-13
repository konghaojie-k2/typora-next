#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for notebook-modal.js（Sprint 17 外壳组件）
 *
 * 覆盖：render 的 prefix id 生成 / takeInput / 气泡渲染与转义 /
 * appendLoadingBubble 返回可移除元素 / lockInput。
 * SocraticModal 行为回归由 tests/sprint8 既有测试钉住。
 */

const TestRunner = require('../../shared/test-runner');
const { buildMockDOM } = require('../../shared/mock-dom');

const { NotebookModal, escapeHtml } = require('../../../dist/scripts/learning/notebook-modal.js');

function setup() {
  const { document, body } = buildMockDOM();
  global.document = document;
  global.window = { document, addEventListener() {}, removeEventListener() {} };
  return { document, body };
}

function makeShell(opts = {}) {
  return new NotebookModal(Object.assign({
    prefix: 'casestudy',
    icon: '📋',
    title: '案例研习',
    subtitle: '概念: rdfs:domain',
    chipsHtml: '<span class="socratic-chip">#rdfs:domain</span>',
    placeholder: '等待案例生成...',
    tutorAvatar: '📋'
  }, opts));
}

// ============================================
// render：prefix 参数化 id
// ============================================
TestRunner.test('render 生成 prefix 命名的 DOM id 并定位 chat/input', () => {
  setup();
  const shell = makeShell();
  shell.render();
  TestRunner.assertExists(global.document.getElementById('casestudyModalOverlay'));
  TestRunner.assertExists(global.document.getElementById('casestudyModalCard'));
  TestRunner.assertExists(global.document.getElementById('casestudyEndBtn'));
  TestRunner.assertExists(shell.chatEl, 'chatEl should be found');
  TestRunner.assertExists(shell.inputEl, 'inputEl should be found');
});

TestRunner.test('prefix=socratic 时 id 与拆分前一致（回归锚）', () => {
  setup();
  const shell = makeShell({ prefix: 'socratic' });
  shell.render();
  TestRunner.assertExists(global.document.getElementById('socraticModalOverlay'));
  TestRunner.assertExists(global.document.getElementById('socraticChat'));
  TestRunner.assertExists(global.document.getElementById('socraticInput'));
  TestRunner.assertExists(global.document.getElementById('socraticSendBtn'));
  TestRunner.assertExists(global.document.getElementById('socraticEndBtn'));
});

TestRunner.test('重复 render 先移除旧 overlay（不叠加）', () => {
  setup();
  const shell = makeShell();
  shell.render();
  shell.render();
  // mock-dom 的 getElementById 跳过 _removed 元素
  const overlay = global.document.getElementById('casestudyModalOverlay');
  TestRunner.assertExists(overlay);
});

// ============================================
// takeInput
// ============================================
TestRunner.test('takeInput 返回 trim 后文本并清空输入框', () => {
  setup();
  const shell = makeShell();
  shell.render();
  shell.inputEl.value = '  你好  ';
  const text = shell.takeInput();
  TestRunner.assertEquals(text, '你好');
  TestRunner.assertEquals(shell.inputEl.value, '');
});

TestRunner.test('takeInput 空文本返回空串且不清空', () => {
  setup();
  const shell = makeShell();
  shell.render();
  shell.inputEl.value = '   ';
  TestRunner.assertEquals(shell.takeInput(), '');
});

// ============================================
// 气泡渲染
// ============================================
TestRunner.test('appendTutorBubble/UserBubble 追加子节点并转义 HTML', () => {
  setup();
  const shell = makeShell();
  shell.render();
  const before = shell.chatEl.childNodes.length;
  shell.appendTutorBubble('<b>粗体</b>应被转义');
  shell.appendUserBubble('我的问题');
  TestRunner.assertEquals(shell.chatEl.childNodes.length, before + 2);
  const tutorBubble = shell.chatEl.childNodes[before];
  TestRunner.assert(tutorBubble.innerHTML.includes('&lt;b&gt;'), 'tutor bubble should escape HTML');
  TestRunner.assert(tutorBubble.innerHTML.includes('📋'), 'tutor bubble should use configured avatar');
});

TestRunner.test('appendLoadingBubble 返回可移除元素', () => {
  setup();
  const shell = makeShell();
  shell.render();
  const before = shell.chatEl.childNodes.length;
  const el = shell.appendLoadingBubble();
  TestRunner.assertEquals(shell.chatEl.childNodes.length, before + 1);
  TestRunner.assert(typeof el.remove === 'function', 'loading el should be removable');
});

// ============================================
// lockInput
// ============================================
TestRunner.test('lockInput 禁用输入并把结束按钮改为关闭', () => {
  setup();
  const shell = makeShell();
  shell.render();
  shell.lockInput();
  TestRunner.assertEquals(shell.inputEl.disabled, true);
  const endBtn = global.document.getElementById('casestudyEndBtn');
  TestRunner.assertEquals(endBtn.textContent, '关闭');
});

// ============================================
// escapeHtml
// ============================================
TestRunner.test('escapeHtml 基础转义', () => {
  setup();
  TestRunner.assertEquals(escapeHtml('<a>&'), '&lt;a&gt;&amp;');
  TestRunner.assertEquals(escapeHtml(null), '');
});

TestRunner.run();
