#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程案例研习（Sprint 17）
 *
 * 真实文件系统 + 真实前端模块：
 * - CaseStudyModal（require dist/scripts/learning/case-study-modal）
 * - mock-tauri 真实 fs（case_study_chat/save/list 三命令）
 * - 静态接线检查（skill / agent-bridge / lib.rs / index.html）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

// DOM mock 必须在 require 前端模块之前（模块顶层会探测 document）
global.document = global.document || {};
global.document.createElement = (tag) => {
  const el = {
    tagName: tag,
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
    className: '',
    style: { cssText: '' },
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    appendChild: (c) => { el.children.push(c); return c; },
    remove: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    querySelector: () => ({
      addEventListener: () => {}, remove: () => {}, focus: () => {}, click: () => {},
      appendChild: (c) => c, setAttribute: () => {}, getAttribute: () => null,
      style: {}, classList: { add: () => {}, remove: () => {} }, textContent: ''
    }),
    querySelectorAll: () => [],
    setAttribute: () => {}, getAttribute: () => null, focus: () => {}, click: () => {}
  };
  return el;
};
global.document.getElementById = global.document.getElementById || (() => null);
global.document.body = global.document.body || { appendChild: () => {}, removeChild: () => {} };
global.document.addEventListener = global.document.addEventListener || (() => {});
global.document.removeEventListener = global.document.removeEventListener || (() => {});

const mockTauri = require('./mock-tauri'); // sets global.window.__TAURI__ (real fs)
global.window.confirm = () => true; // 二次确认自动通过

const { CaseStudyModal } = require('../../dist/scripts/learning/case-study-modal');

const steps = new StepRegistry();

const SKILL_MD = path.join(__dirname, '../../src-tauri/skills/typora-course-case-study/SKILL.md');
const BRIDGE = path.join(__dirname, '../../agent-bridge.mjs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MAIN_JS = path.join(__dirname, '../../dist/scripts/main.js');
const MODE_INTEGRATION_JS = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
const LEARNING_CSS = path.join(__dirname, '../../dist/styles/learning.css');

let _tmpDirs = [];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'cs17-'));
  _tmpDirs.push(d);
  return d;
}

function writeSession(projectPath, endedAt, selectedText, turnCount) {
  const dir = path.join(projectPath, '.learning', 'case-studies');
  fs.mkdirSync(dir, { recursive: true });
  const session = {
    version: '1.0',
    selected_text: selectedText,
    chapter_file: '01-ch.md',
    session_id: 's-1',
    turns: Array.from({ length: turnCount }, (_, i) => ({ role: i % 2 ? 'user' : 'tutor', content: `t${i}` })),
    started_at: endedAt,
    ended_at: endedAt,
    end_reason: 'user_ended'
  };
  const file = path.join(dir, endedAt.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  return session;
}

// ============================================
// Given
// ============================================
steps.given('a course project and a selected concept', function() {
  this.projectPath = tmpdir('cs17-new-');
  this.modal = new CaseStudyModal({
    projectPath: this.projectPath,
    selectedText: 'rdfs:domain',
    context: { chapterTitle: '第0章', chapterGoal: '掌握 RDFS 词汇', surroundingText: '' },
    chapterFile: '00-ch.md'
  });
});

steps.given('an opened case study modal with a generated case', async function() {
  this.projectPath = tmpdir('cs17-open-');
  this.modal = new CaseStudyModal({
    projectPath: this.projectPath,
    selectedText: 'rdfs:domain',
    context: null,
    chapterFile: '00-ch.md'
  });
  await this.modal.open();
});

steps.given('an opened case study modal with dialogue turns', async function() {
  this.projectPath = tmpdir('cs17-end-');
  this.modal = new CaseStudyModal({
    projectPath: this.projectPath,
    selectedText: 'rdfs:domain',
    context: null,
    chapterFile: '00-ch.md'
  });
  await this.modal.open(); // 首轮
  this.modal._shell.takeInput = () => '那 range 呢？';
  await this.modal._handleSend(); // 追问一轮
});

steps.given('an opened case study modal whose save will fail', async function() {
  this.projectPath = tmpdir('cs17-fail-');
  this.modal = new CaseStudyModal({
    projectPath: this.projectPath,
    selectedText: 'rdfs:domain',
    context: null,
    chapterFile: '00-ch.md'
  });
  await this.modal.open();
  // 让 save 失败：目录占位为文件，mkdir 必败
  fs.writeFileSync(path.join(this.projectPath, '.learning'), 'block');
});

steps.given('two saved case study sessions on disk', function() {
  this.projectPath = tmpdir('cs17-hist-');
  writeSession(this.projectPath, '2026-08-10T10:00:00', 'rdfs:domain', 4);
  writeSession(this.projectPath, '2026-08-11T09:00:00', 'rdf:type', 6);
});

steps.given('a saved case study session on disk', function() {
  this.projectPath = tmpdir('cs17-ro-');
  this.savedSession = writeSession(this.projectPath, '2026-08-11T09:00:00', 'rdf:type', 4);
});

steps.given('the real project sources', function() {
  this.skillContent = fs.readFileSync(SKILL_MD, 'utf-8');
  this.bridgeContent = fs.readFileSync(BRIDGE, 'utf-8');
  this.libRs = fs.readFileSync(LIB_RS, 'utf-8');
  this.aiAgentRs = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  this.indexHtml = fs.readFileSync(INDEX_HTML, 'utf-8');
  this.mainJs = fs.readFileSync(MAIN_JS, 'utf-8');
  this.modeIntegration = fs.readFileSync(MODE_INTEGRATION_JS, 'utf-8');
  this.learningCss = fs.readFileSync(LEARNING_CSS, 'utf-8');
});

// ============================================
// When
// ============================================
steps.when('the case study modal opens', async function() {
  await this.modal.open();
});

steps.when('the user sends a follow-up question', async function() {
  this.modal._shell.takeInput = () => '如果换成酒店预订领域呢？';
  await this.modal._handleSend();
});

steps.when('the user ends the session', async function() {
  this.modal._handleEndClick(); // confirm=true → confirmEnd
  await new Promise(r => setTimeout(r, 50)); // 等 confirmEnd 的异步落盘
});

steps.when('case study history is listed', async function() {
  this.sessions = await global.window.__TAURI__.core.invoke('case_study_list_sessions', {
    projectPath: this.projectPath
  });
});

steps.when('the session is reopened read-only', async function() {
  this.callsBefore = mockTauri.getCaseStudyChatCalls().length;
  this.modal = new CaseStudyModal({ projectPath: this.projectPath, savedSession: this.savedSession });
  await this.modal.open();
});

// ============================================
// Then
// ============================================
steps.then('case_study_chat should be invoked with the selected concept and no user answer', function() {
  const calls = mockTauri.getCaseStudyChatCalls();
  const last = calls[calls.length - 1];
  if (!last) throw new Error('case_study_chat was not invoked');
  if (last.selectedText !== 'rdfs:domain') {
    throw new Error(`selectedText mismatch: ${last.selectedText}`);
  }
  if (last.userAnswer !== null && last.userAnswer !== undefined) {
    throw new Error(`first turn should have no userAnswer, got: ${last.userAnswer}`);
  }
});

steps.then('case_study_chat should be invoked with the answer and captured session id', function() {
  const calls = mockTauri.getCaseStudyChatCalls();
  const last = calls[calls.length - 1];
  if (!last || !last.userAnswer) throw new Error('follow-up call missing userAnswer');
  if (last.userAnswer !== '如果换成酒店预订领域呢？') {
    throw new Error(`unexpected userAnswer: ${last.userAnswer}`);
  }
  if (last.sessionId !== 'mock-case-session-1') {
    throw new Error(`session id not captured from first turn, got: ${last.sessionId}`);
  }
});

steps.then('a session file should be written under case-studies with the contract fields', function() {
  const dir = path.join(this.projectPath, '.learning', 'case-studies');
  if (!fs.existsSync(dir)) throw new Error('case-studies dir not created');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected 1 session file, got ${files.length}`);
  const s = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  for (const key of ['selected_text', 'chapter_file', 'turns', 'started_at', 'ended_at', 'end_reason']) {
    if (!(key in s)) throw new Error(`session missing contract field: ${key}`);
  }
  if (s.selected_text !== 'rdfs:domain') throw new Error('selected_text mismatch');
  if (!Array.isArray(s.turns) || s.turns.length < 3) {
    throw new Error(`expected ≥3 turns (首轮+追问+回答), got ${(s.turns || []).length}`);
  }
});

steps.then('the modal should stay open and allow retrying the save', function() {
  if (this.modal.opened !== true) throw new Error('modal closed despite save failure');
  if (this.modal._sessionSaved !== false) {
    throw new Error('_sessionSaved should reset to false after failure for retry');
  }
});

steps.then('sessions should come back newest first', function() {
  if (!Array.isArray(this.sessions) || this.sessions.length !== 2) {
    throw new Error(`expected 2 sessions, got ${(this.sessions || []).length}`);
  }
  if (this.sessions[0].selected_text !== 'rdf:type') {
    throw new Error(`newest first violated: ${this.sessions[0].selected_text}`);
  }
});

steps.then('no case_study_chat call should happen and the input should be locked', function() {
  const callsAfter = mockTauri.getCaseStudyChatCalls().length;
  if (callsAfter !== this.callsBefore) {
    throw new Error('read-only reopen triggered case_study_chat');
  }
  if (this.modal._readOnly !== true) throw new Error('modal not in read-only mode');
  if (this.modal._sessionSaved !== true) {
    throw new Error('read-only mode should be pre-marked saved (no re-persist)');
  }
});

steps.then('the case study skill should exist with valid frontmatter and constraints', function() {
  if (!this.skillContent.includes('name: typora-course-case-study')) {
    throw new Error('SKILL.md missing typora-course-case-study name frontmatter');
  }
  if (!this.skillContent.includes('禁止半角双引号')) {
    throw new Error('SKILL.md missing 禁止半角双引号 constraint');
  }
  if (!this.skillContent.includes('📖 情境') || !this.skillContent.includes('🔍 分析') || !this.skillContent.includes('🔗 回扣')) {
    throw new Error('SKILL.md missing three-part case structure');
  }
});

steps.then('the bridge should wire the case-study stage', function() {
  if (!this.bridgeContent.includes("case 'case-study'")) {
    throw new Error('agent-bridge.mjs missing case-study stage');
  }
  if (!this.bridgeContent.includes('typora-course-case-study skill')) {
    throw new Error('agent-bridge.mjs does not reference the skill by name');
  }
});

steps.then('Rust should register the case study commands', function() {
  if (!this.aiAgentRs.includes('pub async fn case_study_chat')) {
    throw new Error('ai_agent.rs missing case_study_chat');
  }
  for (const cmd of ['ai_agent::case_study_chat', 'case_study_save_session', 'case_study_list_sessions']) {
    if (!this.libRs.includes(cmd)) throw new Error(`lib.rs missing registration: ${cmd}`);
  }
});

steps.then('index.html should load the case study modules', function() {
  if (!this.indexHtml.includes('scripts/learning/notebook-modal.js')) {
    throw new Error('index.html does not load notebook-modal.js');
  }
  if (!this.indexHtml.includes('scripts/learning/case-study-modal.js')) {
    throw new Error('index.html does not load case-study-modal.js');
  }
});

// ============================================
// UX 修正（2026-08-11）：原地触发 + 防遮挡
// ============================================
steps.then('the selection toolbar should contain a case study button', function() {
  if (!this.mainJs.includes('id="caseStudySelectionBtn"')) {
    throw new Error('selection toolbar missing caseStudySelectionBtn');
  }
});

steps.then('the selection toolbar should toggle it together with the explain button', function() {
  const fnIdx = this.mainJs.indexOf('function showSelectionToolbar');
  if (fnIdx < 0) throw new Error('main.js missing showSelectionToolbar');
  const body = this.mainJs.slice(fnIdx, fnIdx + 1200);
  if (!body.includes('caseStudySelectionBtn')) {
    throw new Error('showSelectionToolbar does not toggle caseStudySelectionBtn');
  }
  if (!body.includes("AppWorkspace.isIn('course')")) {
    throw new Error('case button visibility not gated on course mode');
  }
});

steps.then('the case study click should call openCaseStudy with the selected text', function() {
  const btnIdx = this.mainJs.indexOf("querySelector('#caseStudySelectionBtn').addEventListener");
  if (btnIdx < 0) throw new Error('caseStudySelectionBtn click handler not bound');
  const body = this.mainJs.slice(btnIdx, btnIdx + 800);
  if (!body.includes('openCaseStudy(text)')) {
    throw new Error('click handler does not call openCaseStudy(text)');
  }
});

steps.then('the cornell sidebar should place action buttons in an actions row', function() {
  if (!this.modeIntegration.includes('cornell-sidebar-actions')) {
    throw new Error('mode-integration missing cornell-sidebar-actions row');
  }
});

steps.then('the footer should not carry the action buttons', function() {
  const footerIdx = this.modeIntegration.indexOf('class="cornell-sidebar-footer"');
  if (footerIdx < 0) throw new Error('mode-integration missing sidebar footer');
  const closeIdx = this.modeIntegration.indexOf('</div>', footerIdx);
  const footerBlock = this.modeIntegration.slice(footerIdx, closeIdx);
  if (footerBlock.includes('cornellExplainBtn') || footerBlock.includes('caseStudyBtn')) {
    throw new Error('action buttons still inside the footer (overlapped by fixed progress bar)');
  }
});

steps.then('the stylesheet should not restyle the footer as flex', function() {
  if (/\.cornell-sidebar-footer\s*\{[^}]*display:\s*flex/.test(this.learningCss)) {
    throw new Error('learning.css still restyles .cornell-sidebar-footer as flex');
  }
  if (!this.learningCss.includes('.cornell-sidebar-actions')) {
    throw new Error('learning.css missing .cornell-sidebar-actions style');
  }
});

// ============================================
// UX 第二轮（2026-08-11）：作用域 / 按钮取舍 / 流式 / 渲染
// ============================================
steps.then('the selection toolbar mouseup handler should be scoped to markdownBody', function() {
  if (!this.mainJs.includes('elements.markdownBody.contains(parentEl)')) {
    throw new Error('selection toolbar mouseup handler not scoped to markdownBody');
  }
});

steps.then('the course selection tracking should be scoped to markdownBody', function() {
  const idx = this.modeIntegration.indexOf('function onSelectionChange');
  if (idx < 0) throw new Error('mode-integration missing onSelectionChange');
  const body = this.modeIntegration.slice(idx, idx + 1200);
  if (!body.includes('mdBody.contains(node)')) {
    throw new Error('onSelectionChange not scoped to markdownBody');
  }
});

steps.then('the cornell sidebar should not contain an explain button', function() {
  const tplIdx = this.modeIntegration.indexOf('cornell-sidebar-actions');
  if (tplIdx < 0) throw new Error('mode-integration missing actions row');
  const actionsBlock = this.modeIntegration.slice(tplIdx, tplIdx + 400);
  if (actionsBlock.includes('cornellExplainBtn')) {
    throw new Error('explain button still in sidebar actions row');
  }
});

steps.then('the case study sidebar button should open history directly', function() {
  const idx = this.modeIntegration.indexOf("getElementById('caseStudyBtn')");
  if (idx < 0) throw new Error('caseStudyBtn binding missing');
  const body = this.modeIntegration.slice(idx, idx + 400);
  if (!body.includes('openHistory')) {
    throw new Error('caseStudyBtn does not open history directly');
  }
  if (body.includes('openCaseStudy(_pendingSelectedText)')) {
    throw new Error('sidebar button still creates new case from selection');
  }
});

steps.then('the bridge should emit case study deltas', function() {
  if (!this.bridgeContent.includes("emit('case_study_delta'")) {
    throw new Error('bridge does not emit case_study_delta');
  }
});

steps.then('Rust should stream case study events to the frontend', function() {
  if (!this.aiAgentRs.includes('emit("case-study-event"')) {
    throw new Error('ai_agent.rs does not emit case-study-event');
  }
});

steps.then('the modal should listen for case study delta events', function() {
  const modalSrc = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/learning/case-study-modal.js'), 'utf-8');
  if (!modalSrc.includes("listen('case-study-event'")) {
    throw new Error('case-study-modal does not listen case-study-event');
  }
});

steps.then('the shell should support streaming bubbles', function() {
  const shellSrc = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/learning/notebook-modal.js'), 'utf-8');
  if (!shellSrc.includes('startTutorStream')) {
    throw new Error('notebook-modal missing startTutorStream');
  }
});

steps.then('the shell should render tutor bubbles via markdownToHtml with escape fallback', function() {
  const shellSrc = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/learning/notebook-modal.js'), 'utf-8');
  if (!shellSrc.includes('window.markdownToHtml')) {
    throw new Error('shell does not use window.markdownToHtml');
  }
  if (!shellSrc.includes('escapeHtml(text)')) {
    throw new Error('shell missing escapeHtml fallback');
  }
});

steps._cleanup = function() {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  _tmpDirs = [];
};

module.exports = steps;
