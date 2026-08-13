#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for case-study-modal.js（Sprint 17 案例研习引擎）
 *
 * 覆盖：构造状态（正常/只读）/ 首轮生成调用 / 追问 session 续聊 /
 * 错误友好提示 / 落盘契约与失败重试 / 结束流程。
 * 外壳 DOM 细节由 test_notebook_modal.js 覆盖；此处用 buildMockDOM 驱动。
 */

const TestRunner = require('../../shared/test-runner');
const { buildMockDOM } = require('../../shared/mock-dom');

const { CaseStudyModal } = require('../../../dist/scripts/learning/case-study-modal.js');

let _invokeCalls;
let _invokeHandler;

function setup() {
  const { document, body } = buildMockDOM();
  global.document = document;
  _invokeCalls = [];
  _invokeHandler = async (cmd, args) => {
    if (cmd === 'case_study_chat') {
      return { content: 'mock 案例内容', done: false, session_id: args.sessionId || 'sess-1' };
    }
    if (cmd === 'case_study_save_session') return '/ok/path.json';
    if (cmd === 'case_study_list_sessions') return [];
    throw new Error('unexpected invoke: ' + cmd);
  };
  global.window = {
    document,
    addEventListener() {}, removeEventListener() {},
    confirm() { return true; },
    NotebookModal: require('../../../dist/scripts/learning/notebook-modal.js').NotebookModal,
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          _invokeCalls.push({ cmd, args });
          return _invokeHandler(cmd, args);
        }
      }
    }
  };
}

function makeModal(opts = {}) {
  return new CaseStudyModal(Object.assign({
    projectPath: '/tmp/p',
    selectedText: 'rdfs:domain',
    context: { chapterTitle: 'c', chapterGoal: 'g', surroundingText: '' },
    chapterFile: '00.md'
  }, opts));
}

// ============================================
// 构造与首轮
// ============================================
TestRunner.test('构造：正常模式初始状态', () => {
  setup();
  const m = makeModal();
  TestRunner.assertEquals(m.opened, false);
  TestRunner.assertEquals(m.turns.length, 0);
  TestRunner.assertEquals(m._readOnly, false);
  TestRunner.assertEquals(m.sessionId, null);
});

TestRunner.test('open 首轮：调用 case_study_chat 无 userAnswer 并捕获 session_id', async () => {
  setup();
  const m = makeModal();
  await m.open();
  const call = _invokeCalls.find(c => c.cmd === 'case_study_chat');
  TestRunner.assertExists(call, 'case_study_chat should be called');
  TestRunner.assertEquals(call.args.selectedText, 'rdfs:domain');
  TestRunner.assertEquals(call.args.userAnswer, null);
  TestRunner.assertEquals(typeof call.args.context, 'string');
  TestRunner.assertEquals(m.sessionId, 'sess-1');
  TestRunner.assertEquals(m.turns.length, 1);
  TestRunner.assertEquals(m.turns[0].role, 'tutor');
});

TestRunner.test('追问：带 userAnswer 与已捕获 sessionId', async () => {
  setup();
  const m = makeModal();
  await m.open();
  m._shell.takeInput = () => '换个领域呢？';
  await m._handleSend();
  const calls = _invokeCalls.filter(c => c.cmd === 'case_study_chat');
  TestRunner.assertEquals(calls.length, 2);
  TestRunner.assertEquals(calls[1].args.userAnswer, '换个领域呢？');
  TestRunner.assertEquals(calls[1].args.sessionId, 'sess-1');
  TestRunner.assertEquals(m.turns.length, 3); // tutor + user + tutor
});

TestRunner.test('invoke 失败 → 友好错误入 turns 不抛出', async () => {
  setup();
  _invokeHandler = async () => { throw new Error('网络炸了'); };
  const m = makeModal();
  await m.open(); // 不应抛出
  TestRunner.assertEquals(m.turns.length, 1);
  TestRunner.assert(m.turns[0].content.includes('暂时无法生成'), 'should show friendly error');
  TestRunner.assert(m.turns[0].content.includes('网络炸了'));
});

// ============================================
// 结束与落盘
// ============================================
TestRunner.test('结束：二次确认后落盘并关闭，payload 符合契约', async () => {
  setup();
  const m = makeModal();
  await m.open();
  m._handleEndClick();
  await new Promise(r => setTimeout(r, 20));
  const save = _invokeCalls.find(c => c.cmd === 'case_study_save_session');
  TestRunner.assertExists(save, 'save should be invoked');
  const s = save.args.session;
  for (const k of ['selected_text', 'chapter_file', 'session_id', 'turns', 'started_at', 'ended_at', 'end_reason']) {
    TestRunner.assert(k in s, `session missing field: ${k}`);
  }
  TestRunner.assertEquals(s.selected_text, 'rdfs:domain');
  TestRunner.assertEquals(s.session_id, 'sess-1');
  TestRunner.assertEquals(m.opened, false);
});

TestRunner.test('落盘失败：保持打开且允许重试', async () => {
  setup();
  const m = makeModal();
  await m.open();
  _invokeHandler = async (cmd) => {
    if (cmd === 'case_study_save_session') throw new Error('磁盘满了');
    return { content: 'x', done: false, session_id: 'sess-1' };
  };
  m._handleEndClick();
  await new Promise(r => setTimeout(r, 20));
  TestRunner.assertEquals(m.opened, true, 'modal should stay open on save failure');
  TestRunner.assertEquals(m._sessionSaved, false, 'should allow retry');
});

TestRunner.test('已保存后点结束直接关闭（不再确认不落盘）', async () => {
  setup();
  const m = makeModal();
  await m.open();
  m._handleEndClick();
  await new Promise(r => setTimeout(r, 20));
  const saveCount = _invokeCalls.filter(c => c.cmd === 'case_study_save_session').length;
  m._handleEndClick(); // 第二次 = 直接关闭
  TestRunner.assertEquals(_invokeCalls.filter(c => c.cmd === 'case_study_save_session').length, saveCount);
  TestRunner.assertEquals(m.opened, false);
});

// ============================================
// 只读回看
// ============================================
TestRunner.test('readOnly：不调用生成、渲染历史、标记已保存', async () => {
  setup();
  const saved = {
    selected_text: 'rdf:type', chapter_file: '00.md', session_id: 's-old',
    turns: [{ role: 'tutor', content: '案例' }, { role: 'user', content: '追问' }]
  };
  const m = makeModal({ selectedText: '', savedSession: saved });
  await m.open();
  TestRunner.assertEquals(_invokeCalls.filter(c => c.cmd === 'case_study_chat').length, 0);
  TestRunner.assertEquals(m._readOnly, true);
  TestRunner.assertEquals(m._sessionSaved, true);
  TestRunner.assertEquals(m.selectedText, 'rdf:type', '概念取自 savedSession');
});

TestRunner.test('readOnly：_handleSend 直接忽略', async () => {
  setup();
  const saved = { selected_text: 'x', turns: [] };
  const m = makeModal({ selectedText: '', savedSession: saved });
  await m.open();
  m._shell.takeInput = () => '不应发送';
  await m._handleSend();
  TestRunner.assertEquals(_invokeCalls.filter(c => c.cmd === 'case_study_chat').length, 0);
});

TestRunner.test('openHistory：无记录时 toast 提示', async () => {
  setup();
  let toastMsg = null;
  global.window.showToast = (msg) => { toastMsg = msg; };
  await CaseStudyModal.openHistory('/tmp/p');
  TestRunner.assert(toastMsg && toastMsg.includes('还没有案例研习记录'), `toast expected, got ${toastMsg}`);
});

TestRunner.run();
