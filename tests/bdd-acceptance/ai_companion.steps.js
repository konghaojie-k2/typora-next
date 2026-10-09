#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for AI 伴学统一入口（解释 / 举例 / 我有话说）
 *
 * 真实文件系统 + 真实前端模块：
 * - AICompanionModal / CompanionCore（require dist/scripts/learning/ai-companion-modal）
 * - mock-tauri 真实 fs（own_voice_chat / own_voice_save_session）
 * - 静态接线检查（气泡单一入口 / 侧栏 / skill / agent-bridge / Rust / index.html）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

// DOM mock 必须在 require 前端模块之前（模块顶层会探测 document）
function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    textContent: '',
    value: '',
    scrollTop: 0,
    scrollHeight: 0,
    className: '',
    innerHTML: '',
    classList: {
      add() {}, remove() {}, contains() { return false; }, toggle() {}
    },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    focus() {}
  };
  return el;
}

// 无条件覆盖：runner 是同进程顺序加载，course_share 等 steps 会把 global.document
// 换成 getter 版 mock（innerHTML 只读），这里必须装回可写版（本套件是 runner 的最后一站）
global.document = {
  createElement: (tag) => makeEl(tag),
  getElementById: () => null,
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  removeEventListener() {}
};

const mockTauri = require('./mock-tauri'); // sets global.window.__TAURI__ (real fs)
// course_share / sprint27 等 steps 会整个替换 global.window，把 mock tauri 重新挂回来
global.window.__TAURI__ = mockTauri.tauriApi;
global.window.confirm = () => true; // 结束二次确认自动通过

const { AICompanionModal, CompanionCore } = require('../../dist/scripts/learning/ai-companion-modal');

const steps = new StepRegistry();

const SKILL_MD = path.join(__dirname, '../../src-tauri/skills/typora-course-own-voice/SKILL.md');
const BRIDGE = path.join(__dirname, '../../agent-bridge.mjs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MAIN_JS = path.join(__dirname, '../../dist/scripts/main.js');
const MODE_INTEGRATION_JS = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
const COMPANION_JS = path.join(__dirname, '../../dist/scripts/learning/ai-companion-modal.js');
const LEARNING_CSS = path.join(__dirname, '../../dist/styles/learning.css');

let _tmpDirs = [];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'companion-'));
  _tmpDirs.push(d);
  return d;
}

function read(p) {
  return fs.readFileSync(p, 'utf-8');
}

// ============================================
// Given：源码装载
// ============================================

steps.given('the app source files are loaded', function() {
  this.mainJs = read(MAIN_JS);
  this.modeIntegration = read(MODE_INTEGRATION_JS);
  this.companionJs = read(COMPANION_JS);
  this.learningCss = read(LEARNING_CSS);
  this.skillContent = fs.existsSync(SKILL_MD) ? read(SKILL_MD) : '';
  this.bridgeContent = read(BRIDGE);
  this.aiAgentRs = read(AI_AGENT_RS);
  this.libRs = read(LIB_RS);
  this.indexHtml = read(INDEX_HTML);
});

// ============================================
// Scenario：划词气泡单一入口
// ============================================

steps.then('the selection toolbar should contain a single companion button', function() {
  if (!this.mainJs.includes('id="aiCompanionBtn"')) {
    throw new Error('selection toolbar missing aiCompanionBtn');
  }
});

steps.then('the companion menu should offer exactly four modes', function() {
  for (const mode of ['explain', 'example', 'talk', 'visualize']) {
    if (!this.mainJs.includes(`data-mode="${mode}"`)) {
      throw new Error(`companion menu missing mode: ${mode}`);
    }
  }
  if (!this.mainJs.includes('💡 给个解释') || !this.mainJs.includes('📋 举个例子')
    || !this.mainJs.includes('💬 我有话说') || !this.mainJs.includes('🖼️ 画个图')) {
    throw new Error('companion menu labels incomplete');
  }
});

steps.then('the old explain and case study bubble buttons should be gone', function() {
  if (this.mainJs.includes('id="aiExplainBtn"')) {
    throw new Error('old aiExplainBtn still in selection toolbar');
  }
  if (this.mainJs.includes('id="caseStudySelectionBtn"')) {
    throw new Error('old caseStudySelectionBtn still in selection toolbar');
  }
});

steps.then('the companion menu should open the unified panel with the picked mode', function() {
  if (!this.mainJs.includes('openAICompanion(text, mode)')) {
    throw new Error('companion menu click does not call openAICompanion(text, mode)');
  }
  const idx = this.modeIntegration.indexOf('async function openAICompanion');
  if (idx < 0) throw new Error('mode-integration missing openAICompanion');
  const body = this.modeIntegration.slice(idx, idx + 1400);
  for (const required of ['AICompanionModal', 'initialMode']) {
    if (!body.includes(required)) throw new Error(`openAICompanion does not wire ${required}`);
  }
});

steps.then('the stylesheet should style the companion entry and mode controls', function() {
  for (const cls of ['.companion-menu', '.companion-mode-seg', '.companion-mode-tag', '.companion-chip', '.companion-mode-tag.t-visualize']) {
    if (!this.learningCss.includes(cls)) {
      throw new Error(`learning.css missing ${cls}`);
    }
  }
});

// ============================================
// Scenario：划线后再点伴学（菜单一闪而过实机回归）
// ============================================

/** 花括号配对提取 marker 后的第一个函数体（同 annotation_notes.steps.js 先例） */
function extractBodyAfterMarker(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

steps.then('global mouseup should not dismiss the toolbar for clicks inside it', function() {
  // main.js 有两个 mouseup 监听（3682 行命名 handler + 划词工具栏的内联 handler），
  // 必须锚定内联版，否则提取到别的函数体
  const body = extractBodyAfterMarker(this.mainJs, "document.addEventListener('mouseup', (e) =>");
  if (!body) throw new Error('缺少全局 mouseup 处理器');
  // 划线会 removeAllRanges() 清空选区但保留工具栏；此时点 ✨，mouseup 看到选区
  // collapsed → setTimeout(hideSelectionToolbar, 150)，而 click 在 mouseup 之后才展开
  // 菜单 → 菜单刚展开 150ms 就被收起。mousedown 已有工具栏内部豁免，mouseup 必须对称。
  if (!body.includes('selectionToolbar.contains(e.target)')) {
    throw new Error(
      'mouseup 缺少工具栏内部点击豁免——划线后点 ✨ 会被当成「点击外部」收起，伴学菜单一闪而过'
    );
  }
});

steps.then('the companion menu should fall back to the active annotation text', function() {
  const idx = this.mainJs.indexOf("companionMenu.querySelectorAll('button')");
  if (idx < 0) throw new Error('缺少伴学菜单项点击处理器');
  const body = this.mainJs.slice(idx, idx + 900);
  // 划线后选区已空，只读 live selection 会静默 return；必须回退到 lastAnnotationId 的划线文本
  if (!body.includes('lastAnnotationId') || !body.includes('data-annotation-id')) {
    throw new Error(
      '伴学菜单只从 live selection 取文本——划线后选区已清空，应回退到 lastAnnotationId 的划线文本'
    );
  }
});

// ============================================
// Scenario：侧栏入口
// ============================================

steps.then('the cornell sidebar should have an own-voice button that opens free talk', function() {
  if (!this.modeIntegration.includes('id="ownVoiceBtn"')) {
    throw new Error('cornell sidebar missing ownVoiceBtn');
  }
  const idx = this.modeIntegration.indexOf("getElementById('ownVoiceBtn')");
  if (idx < 0) throw new Error('ownVoiceBtn binding missing');
  const body = this.modeIntegration.slice(idx, idx + 300);
  if (!body.includes("openAICompanion('', 'talk')")) {
    throw new Error('ownVoiceBtn does not open free talk');
  }
});

steps.then('the sidebar history entry should merge both session kinds', function() {
  if (!this.modeIntegration.includes("getElementById('companionHistoryBtn')")) {
    throw new Error('cornell sidebar missing companionHistoryBtn');
  }
  const idx = this.modeIntegration.indexOf('async function openCompanionHistory');
  if (idx < 0) throw new Error('mode-integration missing openCompanionHistory');
  const body = this.modeIntegration.slice(idx, idx + 4600);
  // 四类数据源都要拉，归并规则交给 CompanionCore.buildRecords（一条 = 一个起点）
  for (const required of ['case_study_list_sessions', 'own_voice_list_sessions',
    'visualize_list_sessions', 'list_project_explanations', 'CompanionCore.buildRecords', 'openAICompanion']) {
    if (!body.includes(required)) throw new Error(`unified history does not wire ${required}`);
  }
  if (!this.modeIntegration.includes('companion-history-kind')) {
    throw new Error('history items missing kind badge');
  }
});

// ============================================
// Scenario：own-voice skill
// ============================================

steps.then('the own-voice skill should exist with its trigger phrase', function() {
  if (!this.skillContent) throw new Error('typora-course-own-voice/SKILL.md missing');
  if (!this.skillContent.includes('name: typora-course-own-voice')) {
    throw new Error('SKILL.md frontmatter name wrong');
  }
  if (!this.skillContent.includes('请使用 typora-course-own-voice skill')) {
    throw new Error('SKILL.md missing host trigger phrase');
  }
});

steps.then('the own-voice skill should require structured feedback sections', function() {
  for (const section of ['✅', '⚠️', '💡', '❓']) {
    if (!this.skillContent.includes(section)) {
      throw new Error(`SKILL.md missing feedback section marker: ${section}`);
    }
  }
  if (!this.skillContent.includes('Reflect') && !this.skillContent.includes('reflect back')) {
    throw new Error('SKILL.md missing reflect-back principle');
  }
});

steps.then('the own-voice skill should forbid ascii double quotes', function() {
  if (!this.skillContent.includes('禁止半角双引号')) {
    throw new Error('SKILL.md missing double-quote ban (2026-08-11 lesson)');
  }
});

// ============================================
// Scenario：own-voice 链路接线
// ============================================

steps.then('the bridge should wire the own-voice stage with streaming deltas', function() {
  if (!this.bridgeContent.includes("case 'own-voice'")) {
    throw new Error('agent-bridge.mjs missing own-voice stage');
  }
  if (!this.bridgeContent.includes('typora-course-own-voice skill')) {
    throw new Error('agent-bridge.mjs does not reference the own-voice skill by name');
  }
  if (!this.bridgeContent.includes("emit('own_voice_delta'")) {
    throw new Error('bridge does not emit own_voice_delta');
  }
  if (!this.companionJs.includes("eventName: 'own-voice-event'")) {
    throw new Error('companion modal does not listen own-voice-event');
  }
});

steps.then('Rust should register the own voice commands', function() {
  if (!this.aiAgentRs.includes('pub async fn own_voice_chat')) {
    throw new Error('ai_agent.rs missing own_voice_chat');
  }
  if (!this.aiAgentRs.includes('emit("own-voice-event"')) {
    throw new Error('ai_agent.rs does not emit own-voice-event');
  }
  for (const cmd of ['ai_agent::own_voice_chat', 'own_voice_save_session']) {
    if (!this.libRs.includes(cmd)) throw new Error(`lib.rs missing registration: ${cmd}`);
  }
});

steps.then('index.html should load the companion module', function() {
  if (!this.indexHtml.includes('scripts/learning/ai-companion-modal.js')) {
    throw new Error('index.html does not load ai-companion-modal.js');
  }
});

steps.then('the companion modal should support resuming a saved talk session', function() {
  // 续聊统一走 opts.record（一条记录 = 一个起点的全部模式部分）
  for (const marker of ['opts.record', 'this._resumed', '_hydrateRecord', 'overwriteFile', 'resumedTurnCount']) {
    if (!this.companionJs.includes(marker)) {
      throw new Error(`companion modal missing resume support: ${marker}`);
    }
  }
  // Rust 侧 list 命令（伴学记录列表数据源）
  if (!this.libRs.includes('own_voice_list_sessions')) {
    throw new Error('lib.rs missing own_voice_list_sessions registration');
  }
});

// ============================================
// Scenario：visualize 链路端到端接线（🖼️ 画个图）
// ============================================

steps.then('the bridge should wire the visualize stage with streaming deltas', function() {
  if (!this.bridgeContent.includes("case 'visualize'")) {
    throw new Error('agent-bridge.mjs missing visualize stage');
  }
  if (!this.bridgeContent.includes('typora-course-visualize skill')) {
    throw new Error('agent-bridge.mjs does not reference the visualize skill by name');
  }
  if (!this.bridgeContent.includes("emit('visualize_delta'")) {
    throw new Error('bridge does not emit visualize_delta');
  }
  // 维基真图检索需要受限 bash（wiki-fetch 白名单脚本）
  if (!/visualizeChat[\s\S]{0,1200}wikiFetch:\s*true/.test(this.bridgeContent)) {
    throw new Error('visualize stage does not enable the wikimedia sandboxed bash (wikiFetch: true)');
  }
});

steps.then('Rust should register the visualize commands', function() {
  if (!this.aiAgentRs.includes('pub async fn visualize_chat')) {
    throw new Error('ai_agent.rs missing visualize_chat');
  }
  if (!this.aiAgentRs.includes('emit("visualize-event"')) {
    throw new Error('ai_agent.rs does not emit visualize-event');
  }
  for (const cmd of ['ai_agent::visualize_chat', 'visualize_save_session', 'visualize_list_sessions']) {
    if (!this.libRs.includes(cmd)) throw new Error(`lib.rs missing registration: ${cmd}`);
  }
});

steps.then('the visualize skill should exist with its trigger phrase', function() {
  const skillPath = require('path').join(__dirname, '../../src-tauri/skills/typora-course-visualize/SKILL.md');
  if (!fs.existsSync(skillPath)) throw new Error('typora-course-visualize/SKILL.md missing');
  this.visualizeSkill = fs.readFileSync(skillPath, 'utf-8');
  if (!this.visualizeSkill.includes('name: typora-course-visualize')) {
    throw new Error('SKILL.md frontmatter name wrong');
  }
  if (!this.visualizeSkill.includes('请使用 typora-course-visualize skill')) {
    throw new Error('SKILL.md missing host trigger phrase');
  }
});

steps.then('the visualize skill should prefer real images over hand-drawn svg', function() {
  // 决策顺序：先 wikimedia-commons 检索真图（mime 过滤 + upload 直链），未命中才手绘 SVG
  for (const marker of ['commons.wikimedia.org', 'upload.wikimedia.org', 'wiki-fetch.mjs']) {
    if (!this.visualizeSkill.includes(marker)) {
      throw new Error(`visualize skill missing wikimedia retrieval: ${marker}`);
    }
  }
  const wikiIdx = this.visualizeSkill.indexOf('commons.wikimedia.org');
  const svgIdx = this.visualizeSkill.indexOf('```svg');
  if (svgIdx === -1) throw new Error('visualize skill missing svg fence output format');
  if (svgIdx < wikiIdx) throw new Error('决策顺序错误：真图检索必须先于手绘 SVG（真图质量 > LLM 手绘）');
});

steps.then('the visualize skill should forbid mermaid and require svg fences', function() {
  // 气泡渲染器不支持 mermaid——skill 必须显式禁止，否则气泡里显示代码文本
  if (!/mermaid/i.test(this.visualizeSkill)) {
    throw new Error('visualize skill must mention the mermaid ban (bubble renderer has no mermaid)');
  }
  if (!/禁止.{0,12}mermaid|不要.{0,12}mermaid|mermaid.{0,12}(不渲染|无法渲染|不会渲染)/i.test(this.visualizeSkill)) {
    throw new Error('visualize skill does not explicitly forbid mermaid output');
  }
  // SVG 规范锚点：浅色底卡 + 680 viewBox + 全 inline 属性（与课程插图一致）
  for (const marker of ['680', 'inline']) {
    if (!this.visualizeSkill.includes(marker)) {
      throw new Error(`visualize skill missing svg spec anchor: ${marker}`);
    }
  }
});

// ============================================
// Scenario：面板路由与落盘（真实模块 + mock tauri）
// ============================================

steps.given('a real companion modal in a temp learning project', function() {
  this.projectPath = tmpdir('companion-project-');
  // 清空 mock 调用记录（module 级状态跨 scenario 存活）
  mockTauri.getOwnVoiceChatCalls().splice(0);
  mockTauri.getExplainSelectionCalls().splice(0);
  mockTauri.getVisualizeChatCalls().splice(0);
});

steps.when('the panel is opened in talk mode', async function() {
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    selectedText: '',
    context: { chapterTitle: '第 3 章 · 注意力机制', chapterGoal: '理解注意力机制', surroundingText: '' },
    chapterFile: '03-attention.md',
    initialMode: 'talk'
  });
  await this.modal.open();
});

steps.then('no LLM call should happen until the student speaks', function() {
  const calls = mockTauri.getOwnVoiceChatCalls();
  if (calls.length !== 0) {
    throw new Error(`opening the panel must not burn tokens, got ${calls.length} LLM calls`);
  }
});

steps.when('the student expresses an understanding', async function() {
  this.utterance = '我理解位置编码就是把每个词的位置信息编进向量里，这样模型就知道词序了。';
  this.modal._shell.inputEl.value = this.utterance;
  this.modal._handleSend();
  // mock invoke 是同步返回的 Promise，让微任务队列排空
  await new Promise((r) => setTimeout(r, 20));
});

steps.then('the own voice chat should be invoked as the first turn', function() {
  const calls = mockTauri.getOwnVoiceChatCalls();
  if (calls.length !== 1) {
    throw new Error(`expected exactly 1 own_voice_chat call, got ${calls.length}`);
  }
  const call = calls[0];
  if (call.firstTurn !== true) throw new Error('first turn flag missing');
  if (call.userAnswer !== this.utterance) throw new Error('student utterance not forwarded');
  if (call.selectedText !== null) throw new Error('free talk should pass selectedText=null');
  if (!call.projectPath) throw new Error('projectPath missing');
});

steps.then('the thread should tag the turn as talk', function() {
  const turns = this.modal.turns;
  if (turns.length !== 2) throw new Error(`expected 2 turns (user+tutor), got ${turns.length}`);
  if (turns[0].role !== 'user' || turns[0].mode !== 'talk') {
    throw new Error('first turn should be user talk turn');
  }
  if (turns[1].role !== 'tutor' || turns[1].mode !== 'talk') {
    throw new Error('second turn should be tutor talk turn');
  }
});

steps.then('ending the panel should persist the talk session to own-voices', async function() {
  await this.modal._confirmEnd();
  if (this.modal.opened !== false) throw new Error('panel should be closed after successful save');

  const dir = path.join(this.projectPath, '.learning', 'own-voices');
  if (!fs.existsSync(dir)) throw new Error('own-voices directory not created');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected 1 session file, got ${files.length}`);

  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.end_reason !== 'user_ended') throw new Error('end_reason should be user_ended');
  if (!Array.isArray(session.turns) || session.turns.length !== 2) {
    throw new Error('session turns should contain user + tutor');
  }
  if (session.turns[0].content !== this.utterance) {
    throw new Error('student utterance should be preserved verbatim');
  }
  if (session.session_id !== 'mock-own-voice-session-1') {
    throw new Error('session_id from response should be recorded');
  }
});

// ============================================
// Scenario：我有话说续聊（伴学记录 → 覆盖原文件）
// ============================================

steps.when('the panel is ended and saved', async function() {
  await this.modal._confirmEnd();
  if (this.modal.opened !== false) throw new Error('panel should be closed after save');
});

steps.when('the panel is reopened from the saved session', async function() {
  const dir = path.join(this.projectPath, '.learning', 'own-voices');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  this.savedFile = files[0];
  const savedSession = JSON.parse(fs.readFileSync(path.join(dir, this.savedFile), 'utf-8'));
  savedSession.file = this.savedFile; // 与 own_voice_list_sessions 注入 file 字段的契约一致

  this.callsBeforeResume = mockTauri.getOwnVoiceChatCalls().length;
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    record: {
      start_key: 'global::test-talk',
      selected_text: '',
      chapter_file: '',
      talk: savedSession
    }
  });
  await this.modal.open();
});

steps.then('the replayed thread should not trigger a new LLM call', function() {
  const calls = mockTauri.getOwnVoiceChatCalls();
  if (calls.length !== this.callsBeforeResume) {
    throw new Error('opening history must not burn tokens');
  }
  if (this.modal.turns.length !== 2) {
    throw new Error(`expected 2 replayed turns, got ${this.modal.turns.length}`);
  }
  if (this.modal.turns[0].mode !== 'talk' || this.modal.turns[1].mode !== 'talk') {
    throw new Error('replayed turns should be tagged as talk');
  }
});

steps.when('the student continues talking and ends the panel', async function() {
  this.followUp = '我再补充一点：RoPE 是在注意力计算时旋转 Q/K。';
  this.modal._shell.inputEl.value = this.followUp;
  this.modal._handleSend();
  await new Promise((r) => setTimeout(r, 20));
  await this.modal._confirmEnd();
});

steps.then('the session should be overwritten in place with the added turns', function() {
  const calls = mockTauri.getOwnVoiceChatCalls();
  if (calls.length !== this.callsBeforeResume + 1) {
    throw new Error(`expected exactly 1 follow-up LLM call, got ${calls.length - this.callsBeforeResume}`);
  }
  const followUpCall = calls[calls.length - 1];
  if (followUpCall.firstTurn !== false) throw new Error('follow-up turn should not be first turn');
  if (followUpCall.sessionId !== 'mock-own-voice-session-1') {
    throw new Error('follow-up should resume the original pi session');
  }

  const dir = path.join(this.projectPath, '.learning', 'own-voices');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1 || files[0] !== this.savedFile) {
    throw new Error(`续聊必须覆盖原文件 ${this.savedFile}，got ${files.join(', ')}`);
  }
  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.turns.length !== 4) throw new Error(`expected 4 turns after resume, got ${session.turns.length}`);
  if (session.turns[2].content !== this.followUp) {
    throw new Error('follow-up utterance should be preserved verbatim');
  }
});

// ============================================
// Scenario：解释记录续聊（伴学记录 💡 → 覆盖原 cue）
// ============================================

steps.then('the sidebar history entry should list saved explanations', function() {
  const idx = this.modeIntegration.indexOf('async function openCompanionHistory');
  if (idx < 0) throw new Error('mode-integration missing openCompanionHistory');
  const body = this.modeIntegration.slice(idx, idx + 4600);
  // 解释记录也要进列表：拉 list_project_explanations，并交给统一的归并模型
  for (const required of ['list_project_explanations', 'buildRecords']) {
    if (!body.includes(required)) throw new Error(`history does not list explanations: ${required}`);
  }
  if (!this.companionJs.includes("caseSessions") || !this.companionJs.includes("talkSessions") || !this.companionJs.includes("visualizeSessions")) {
    throw new Error('buildRecords does not take all four sources');
  }
  // 任何一条记录的点击都带整条 record 进面板续聊（含解释/举例/我有话说的全部部分）
  if (!body.includes('openAICompanion(item.record.selected_text, item.primary, { record: item.record })')) {
    throw new Error('history item does not resume with its whole record');
  }
});

steps.given('an existing explanation conversation with two rounds', function() {
  this.explainConv = {
    id: 'cue-2',
    selected_text: '位置编码',
    chapter: '03-attention',
    rounds: 2,
    created_at: '2026-09-01T08:00:00.000Z',
    last_ts: '2026-09-01T08:05:00.000Z',
    qa_history: [
      { q: '位置编码是什么？', a: '把位置信息编进向量的方式。', ts: '2026-09-01T08:00:00.000Z' },
      { q: '和 RoPE 什么关系？', a: 'RoPE 是一种旋转式的位置编码。', ts: '2026-09-01T08:05:00.000Z' }
    ]
  };
  mockTauri.mockInvoke('persist_explanation', {
    projectPath: this.projectPath,
    chapter: '03-attention',
    conversation: this.explainConv
  });
});

steps.when('the panel is reopened from the explanation record', async function() {
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    record: {
      start_key: '03-attention::位置编码',
      selected_text: this.explainConv.selected_text,
      chapter_file: '03-attention.md',
      explain: this.explainConv
    }
  });
  await this.modal.open();
});

steps.then('the replayed explain thread should not trigger a new LLM call', function() {
  const calls = mockTauri.getExplainSelectionCalls();
  if (calls.length !== 0) {
    throw new Error(`opening the explanation record must not burn tokens, got ${calls.length} LLM calls`);
  }
  // 2 轮问答 → 4 条气泡（user/tutor 交替）
  const turns = this.modal.turns;
  if (turns.length !== 4) throw new Error(`expected 4 replayed turns, got ${turns.length}`);
  if (turns.some((t) => t.mode !== 'explain')) {
    throw new Error('replayed explanation turns should be tagged as explain');
  }
  if (turns[0].role !== 'user' || turns[0].content !== '位置编码是什么？') {
    throw new Error('replayed order should start with the first question');
  }
});

steps.when('the student asks a follow-up in explain mode', async function() {
  this.followUpQ = '那它和绝对位置编码比有什么优势？';
  this.modal._shell.inputEl.value = this.followUpQ;
  this.modal._handleSend();
  await new Promise((r) => setTimeout(r, 20));
});

steps.then('the explain turn should carry the prior history', function() {
  const calls = mockTauri.getExplainSelectionCalls();
  if (calls.length !== 1) throw new Error(`expected exactly 1 explain call, got ${calls.length}`);
  const call = calls[0];
  if (call.text !== this.followUpQ) throw new Error('follow-up question not forwarded');
  if (!Array.isArray(call.previousQa) || call.previousQa.length !== 2) {
    throw new Error(`previousQa should carry the 2 replayed rounds, got ${(call.previousQa || []).length}`);
  }
  if (!call.projectPath) throw new Error('projectPath missing');
});

steps.then('the explanation should be overwritten in place with the added round', function() {
  const dir = path.join(this.projectPath, '.learning', 'explanations', '03-attention');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1 || files[0] !== 'cue-2.json') {
    throw new Error(`续聊必须覆盖原 cue 文件 cue-2.json，got ${files.join(', ')}`);
  }
  const conv = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (conv.qa_history.length !== 3) {
    throw new Error(`expected 3 rounds after follow-up, got ${conv.qa_history.length}`);
  }
  if (conv.qa_history[2].q !== this.followUpQ) {
    throw new Error('follow-up question should be appended verbatim');
  }
  if (conv.selected_text !== '位置编码') {
    throw new Error('conversation identity (selected_text) should be preserved');
  }
});

// ============================================
// Scenario：举例模式（原案例研习面板的职责，已并入伴学面板）
// ============================================

const CONCEPT = 'rdfs:domain';
const EXAMPLE_CHAPTER = '00-ch.md';

steps.given('a saved example session on disk', async function() {
  await mockTauri.mockInvoke('case_study_save_session', {
    projectPath: this.projectPath,
    session: {
      version: '1.0',
      start_key: '00-ch::' + CONCEPT,
      selected_text: CONCEPT,
      chapter_file: EXAMPLE_CHAPTER,
      session_id: 'mock-case-session-1',
      started_at: '2026-09-18T09:00:00.000Z',
      ended_at: '2026-09-18T09:10:00.000Z',
      end_reason: 'user_ended',
      turns: [
        { role: 'user', content: '举个例子' },
        { role: 'tutor', content: '📖 情境\n某铁路公司要整合调度数据。' }
      ]
    }
  });
  // 走真实 listing 拿会话（file 字段由 list_sessions 注入，续聊靠它覆盖原文件）
  const listed = await mockTauri.mockInvoke('case_study_list_sessions', { projectPath: this.projectPath });
  this.savedExample = listed[0];
  this.savedTurns = (this.savedExample.turns || []).length;
  this.callsBeforeResume = mockTauri.getCaseStudyChatCalls().length;
});

async function openExamplePanel(ctx) {
  ctx.modal = new AICompanionModal({
    projectPath: ctx.projectPath,
    selectedText: CONCEPT,
    context: { chapterTitle: '第0章', chapterGoal: '掌握 RDFS 词汇', surroundingText: '' },
    chapterFile: EXAMPLE_CHAPTER,
    initialMode: 'example'
  });
  await ctx.modal.open();
}

steps.when('the panel is opened in example mode', function() {
  return openExamplePanel(this);
});

steps.when('the panel is opened in example mode with an unwritable project', async function() {
  // 让落盘必败：.learning 占位成文件，mkdir 必报 ENOTDIR
  fs.writeFileSync(path.join(this.projectPath, '.learning'), 'block');
  await openExamplePanel(this);
});

steps.then('the case study chat should be invoked with the concept and no user answer', function() {
  const calls = mockTauri.getCaseStudyChatCalls();
  const last = calls[calls.length - 1];
  if (!last) throw new Error('case_study_chat was not invoked');
  if (last.selectedText !== CONCEPT) throw new Error(`selectedText mismatch: ${last.selectedText}`);
  if (last.userAnswer !== null && last.userAnswer !== undefined) {
    throw new Error(`first turn should have no userAnswer, got: ${last.userAnswer}`);
  }
  if (last.projectPath !== this.projectPath) throw new Error('projectPath missing');
});

steps.when('the student asks a follow-up in example mode', async function() {
  this.followUpQ = '如果换成酒店预订领域呢？';
  this.modal._shell.inputEl.value = this.followUpQ;
  this.modal._handleSend();
  await new Promise((r) => setTimeout(r, 20));
});

steps.then('the case study chat should be invoked with the answer and the captured session id', function() {
  const calls = mockTauri.getCaseStudyChatCalls();
  const last = calls[calls.length - 1];
  if (!last || last.userAnswer !== this.followUpQ) {
    throw new Error(`follow-up call missing userAnswer: ${last && last.userAnswer}`);
  }
  if (last.sessionId !== 'mock-case-session-1') {
    throw new Error(`follow-up should resume the pi session, got: ${last.sessionId}`);
  }
});

steps.when('the user ends the session', async function() {
  await this.modal._confirmEnd();
});

steps.then('ending the panel should persist the example session with its start key', function() {
  if (this.modal.opened !== false) throw new Error('panel should be closed after successful save');
  const dir = path.join(this.projectPath, '.learning', 'case-studies');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected 1 session file, got ${files.length}`);
  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.start_key !== '00-ch::' + CONCEPT) {
    throw new Error(`start_key should mark the record's start point, got: ${session.start_key}`);
  }
  if (session.selected_text !== CONCEPT) throw new Error('selected_text missing');
  if (session.chapter_file !== EXAMPLE_CHAPTER) throw new Error('chapter_file missing');
  if (session.end_reason !== 'user_ended') throw new Error('end_reason should be user_ended');
  if (session.session_id !== 'mock-case-session-1') throw new Error('session_id from response should be recorded');
  if (session.turns.length !== 4) throw new Error(`expected 4 turns, got ${session.turns.length}`);
});

steps.when('the panel is reopened from the saved example session', async function() {
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    record: {
      start_key: this.savedExample.start_key,
      selected_text: this.savedExample.selected_text,
      chapter_file: this.savedExample.chapter_file,
      example: this.savedExample
    }
  });
  await this.modal.open();
});

steps.then('the replayed example thread should not trigger a new LLM call', function() {
  const calls = mockTauri.getCaseStudyChatCalls();
  if (calls.length !== this.callsBeforeResume) throw new Error('opening history must not burn tokens');
  if (this.modal.turns.length !== this.savedTurns) {
    throw new Error(`expected ${this.savedTurns} replayed turns, got ${this.modal.turns.length}`);
  }
  if (this.modal.turns.some((t) => t.mode !== 'example')) {
    throw new Error('replayed turns should be tagged as example');
  }
});

steps.when('the student continues the example and ends the panel', async function() {
  this.modal._shell.inputEl.value = '再举一个物流的例子';
  this.modal._handleSend();
  await new Promise((r) => setTimeout(r, 20));
  await this.modal._confirmEnd();
});

steps.then('the example session should be overwritten in place', function() {
  const dir = path.join(this.projectPath, '.learning', 'case-studies');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1 || files[0] !== this.savedExample.file) {
    throw new Error(`续聊必须覆盖原文件 ${this.savedExample.file}，got ${files.join(', ')}`);
  }
  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.turns.length !== this.savedTurns + 2) {
    throw new Error(`expected ${this.savedTurns + 2} turns after resume, got ${session.turns.length}`);
  }
});

steps.when('the saved session is reopened and ended without sending anything', async function() {
  const dir = path.join(this.projectPath, '.learning', 'case-studies');
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))[0];
  this.beforeContent = fs.readFileSync(path.join(dir, file), 'utf-8');
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    record: {
      start_key: this.savedExample.start_key,
      selected_text: this.savedExample.selected_text,
      chapter_file: this.savedExample.chapter_file,
      example: JSON.parse(this.beforeContent)
    }
  });
  await this.modal.open();
  await this.modal._confirmEnd();
});

steps.then('the session file should be left untouched', function() {
  const dir = path.join(this.projectPath, '.learning', 'case-studies');
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))[0];
  if (fs.readFileSync(path.join(dir, file), 'utf-8') !== this.beforeContent) {
    throw new Error('翻开历史但不追问，不应重写会话文件');
  }
});

steps.then('the panel should stay open and allow retrying the save', function() {
  if (this.modal.opened !== true) throw new Error('落盘失败时面板不应关闭');
  if (this.modal._saved !== false) throw new Error('落盘失败应允许重试（_saved 复位）');
});

// ============================================
// Scenario：画图模式（🖼️ 画个图，session + 流式，与举例同构）
// ============================================

steps.when('the panel is opened in visualize mode', function() {
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    selectedText: CONCEPT,
    context: { chapterTitle: '第0章', chapterGoal: '掌握 RDFS 词汇', surroundingText: '' },
    chapterFile: EXAMPLE_CHAPTER,
    initialMode: 'visualize'
  });
  return this.modal.open();
});

steps.then('the visualize chat should be invoked with the concept and no user answer', function() {
  const calls = mockTauri.getVisualizeChatCalls();
  const last = calls[calls.length - 1];
  if (!last) throw new Error('visualize_chat was not invoked');
  if (last.selectedText !== CONCEPT) throw new Error(`selectedText mismatch: ${last.selectedText}`);
  if (last.userAnswer !== null && last.userAnswer !== undefined) {
    throw new Error(`first turn should have no userAnswer, got: ${last.userAnswer}`);
  }
  if (last.projectPath !== this.projectPath) throw new Error('projectPath missing');
});

steps.when('the student asks a follow-up in visualize mode', async function() {
  this.followUpQ = '把悬键标出来再画一张';
  this.modal._shell.inputEl.value = this.followUpQ;
  this.modal._handleSend();
  // mock invoke 是同步返回的 Promise，让微任务队列排空
  await new Promise((r) => setTimeout(r, 20));
});

steps.then('the visualize chat should be invoked with the answer and the captured session id', function() {
  const calls = mockTauri.getVisualizeChatCalls();
  const last = calls[calls.length - 1];
  if (!last || last.userAnswer !== this.followUpQ) {
    throw new Error(`follow-up call missing userAnswer: ${last && last.userAnswer}`);
  }
  if (last.sessionId !== 'mock-visualize-session-1') {
    throw new Error(`follow-up should resume the pi session, got: ${last.sessionId}`);
  }
});

steps.then('ending the panel should persist the visualize session with its start key', function() {
  if (this.modal.opened !== false) throw new Error('panel should be closed after successful save');
  const dir = path.join(this.projectPath, '.learning', 'visualizations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected 1 session file, got ${files.length}`);
  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.start_key !== '00-ch::' + CONCEPT) {
    throw new Error(`start_key should mark the record's start point, got: ${session.start_key}`);
  }
  if (session.selected_text !== CONCEPT) throw new Error('selected_text missing');
  if (session.chapter_file !== EXAMPLE_CHAPTER) throw new Error('chapter_file missing');
  if (session.end_reason !== 'user_ended') throw new Error('end_reason should be user_ended');
  if (session.session_id !== 'mock-visualize-session-1') throw new Error('session_id from response should be recorded');
  if (session.turns.length !== 4) throw new Error(`expected 4 turns, got ${session.turns.length}`);
});

// ============================================
// Scenario：画图续聊（伴学记录 🖼️ → 覆盖原会话）
// ============================================

steps.given('a saved visualize session on disk', async function() {
  await mockTauri.mockInvoke('visualize_save_session', {
    projectPath: this.projectPath,
    session: {
      version: '1.0',
      start_key: '00-ch::' + CONCEPT,
      selected_text: CONCEPT,
      chapter_file: EXAMPLE_CHAPTER,
      session_id: 'mock-visualize-session-1',
      started_at: '2026-10-09T09:00:00.000Z',
      ended_at: '2026-10-09T09:05:00.000Z',
      end_reason: 'user_ended',
      turns: [
        { role: 'user', content: CONCEPT },
        { role: 'tutor', content: '看图：\n```svg\n<svg viewBox="0 0 680 120"></svg>\n```' }
      ]
    }
  });
  // 走真实 listing 拿会话（file 字段由 list_sessions 注入，续聊靠它覆盖原文件）
  const listed = await mockTauri.mockInvoke('visualize_list_sessions', { projectPath: this.projectPath });
  this.savedVisualize = listed[0];
  this.savedVisualizeTurns = (this.savedVisualize.turns || []).length;
  this.callsBeforeResume = mockTauri.getVisualizeChatCalls().length;
});

steps.when('the panel is reopened from the saved visualize session', async function() {
  this.modal = new AICompanionModal({
    projectPath: this.projectPath,
    record: {
      start_key: this.savedVisualize.start_key,
      selected_text: this.savedVisualize.selected_text,
      chapter_file: this.savedVisualize.chapter_file,
      visualize: this.savedVisualize
    }
  });
  await this.modal.open();
});

steps.then('the replayed visualize thread should not trigger a new LLM call', function() {
  const calls = mockTauri.getVisualizeChatCalls();
  if (calls.length !== this.callsBeforeResume) throw new Error('opening history must not burn tokens');
  if (this.modal.turns.length !== this.savedVisualizeTurns) {
    throw new Error(`expected ${this.savedVisualizeTurns} replayed turns, got ${this.modal.turns.length}`);
  }
  if (this.modal.turns.some((t) => t.mode !== 'visualize')) {
    throw new Error('replayed turns should be tagged as visualize');
  }
});

steps.when('the student continues the figure and ends the panel', async function() {
  this.modal._shell.inputEl.value = '改成俯视角度再画一张';
  this.modal._handleSend();
  await new Promise((r) => setTimeout(r, 20));
  await this.modal._confirmEnd();
});

steps.then('the visualize session should be overwritten in place', function() {
  const dir = path.join(this.projectPath, '.learning', 'visualizations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1 || files[0] !== this.savedVisualize.file) {
    throw new Error(`续聊必须覆盖原文件 ${this.savedVisualize.file}，got ${files.join(', ')}`);
  }
  const session = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
  if (session.turns.length !== this.savedVisualizeTurns + 2) {
    throw new Error(`expected ${this.savedVisualizeTurns + 2} turns after resume, got ${session.turns.length}`);
  }
});

// ============================================
// Scenario：一条记录 = 一个起点（同概念跨模式归并）
// ============================================

steps.given('an explanation record and an example session on the same concept', function() {
  const concept = '位置编码';
  // 💡 解释：身份天然是 (章节, 概念)
  this.conv = {
    id: 'cue-1', selected_text: concept, chapter: '03-attention', rounds: 1,
    created_at: '2026-09-19T10:00:00.000Z', last_ts: '2026-09-19T10:00:00.000Z',
    qa_history: [{ q: '位置编码是什么？', a: '把位置信息编进向量。', ts: '2026-09-19T10:00:00.000Z' }]
  };
  // 📋 举例：同一个起点（start_key 由面板落盘时打上），但发生在同一次对话里
  this.exampleSession = {
    version: '1.0',
    start_key: '03-attention::' + concept,
    selected_text: concept,
    chapter_file: '03-attention.md',
    session_id: 'mock-case-1',
    started_at: '2026-09-19T10:05:00.000Z',
    ended_at: '2026-09-19T10:12:00.000Z',
    end_reason: 'user_ended',
    turns: [
      { role: 'user', content: '举个位置编码的例子' },
      { role: 'tutor', content: '比如「猫坐在垫子上」…' },
      { role: 'user', content: '那换成别的顺序呢' },
      { role: 'tutor', content: '顺序变了向量也变…' }
    ]
  };
  // 💬 全局起点（没划词）：自己一条
  this.globalSession = {
    version: '1.0',
    start_key: 'global::2026-09-20T09:12:00.000Z',
    selected_text: '',
    chapter_file: '',
    session_id: 'mock-own-voice-2',
    started_at: '2026-09-20T09:12:00.000Z',
    ended_at: '2026-09-20T09:20:00.000Z',
    end_reason: 'user_ended',
    turns: [
      { role: 'user', content: '我对注意力的理解是…' },
      { role: 'tutor', content: '✅ 你说对的部分…' }
    ]
  };
  for (const s of [this.exampleSession, this.globalSession]) {
    mockTauri.mockInvoke(
      s.start_key.indexOf('global::') === 0 ? 'own_voice_save_session' : 'case_study_save_session',
      { projectPath: this.projectPath, session: s }
    );
  }
  mockTauri.mockInvoke('persist_explanation', {
    projectPath: this.projectPath, chapter: '03-attention', conversation: this.conv
  });
});

steps.when('the learning records are collected', async function() {
  const [caseSessions, talkSessions, visualizeSessions, explanations] = await Promise.all([
    mockTauri.mockInvoke('case_study_list_sessions', { projectPath: this.projectPath }),
    mockTauri.mockInvoke('own_voice_list_sessions', { projectPath: this.projectPath }),
    mockTauri.mockInvoke('visualize_list_sessions', { projectPath: this.projectPath }),
    mockTauri.mockInvoke('list_project_explanations', { projectPath: this.projectPath })
  ]);
  this.records = CompanionCore.buildRecords({ explanations, caseSessions, talkSessions, visualizeSessions });
});

steps.then('the concept should appear as a single record', function() {
  const hit = this.records.filter((r) => r.title === '位置编码');
  if (hit.length !== 1) {
    throw new Error(`同一概念应归并为一条记录，got ${hit.length} 条：${this.records.map((r) => r.title).join(', ')}`);
  }
  // 解释 1 轮 + 举例 2 轮 = 3 轮，模式摘要两种
  if (hit[0].rounds !== 3) throw new Error(`expected 3 rounds, got ${hit[0].rounds}`);
  if (hit[0].primary !== 'explain') throw new Error('起点是解释，主模式应为 explain');
  if (hit[0].modes !== '💡1 📋2') throw new Error(`mode summary wrong: ${hit[0].modes}`);
  if (hit[0].chapter !== '03-attention') throw new Error('chapter should be the stem');
});

steps.then('the record should carry both parts for resuming', function() {
  const rec = this.records.filter((r) => r.title === '位置编码')[0].record;
  if (!rec.explain || !rec.example) throw new Error('record should carry both explain and example parts');
  if (rec.talk) throw new Error('this record has no talk part');
  if (rec.start_key !== '03-attention::位置编码') throw new Error(`start_key wrong: ${rec.start_key}`);
});

steps.then('an unselected free-talk session should stay its own record', function() {
  const globals = this.records.filter((r) => r.global);
  if (globals.length !== 1) throw new Error(`全局起点应各成一条，got ${globals.length}`);
  if (globals[0].title !== '我有话说') throw new Error(`global record title wrong: ${globals[0].title}`);
  if (globals[0].rounds !== 1) throw new Error(`expected 1 round, got ${globals[0].rounds}`);
  if (globals[0].record.explain || globals[0].record.example) {
    throw new Error('global record must not absorb other parts');
  }
});

// ============================================
// Scenario：画图部分并入同一起点的记录
// ============================================

steps.given('an explanation record and a visualize session on the same concept', function() {
  const concept = '位置编码';
  this.conv = {
    id: 'cue-1', selected_text: concept, chapter: '03-attention', rounds: 1,
    created_at: '2026-10-09T10:00:00.000Z', last_ts: '2026-10-09T10:00:00.000Z',
    qa_history: [{ q: '位置编码是什么？', a: '把位置信息编进向量。', ts: '2026-10-09T10:00:00.000Z' }]
  };
  // 🖼️ 画图：同一个起点（start_key 由面板落盘时打上）
  this.visualizeSession = {
    version: '1.0',
    start_key: '03-attention::' + concept,
    selected_text: concept,
    chapter_file: '03-attention.md',
    session_id: 'mock-visualize-1',
    started_at: '2026-10-09T10:05:00.000Z',
    ended_at: '2026-10-09T10:08:00.000Z',
    end_reason: 'user_ended',
    turns: [
      { role: 'user', content: concept },
      { role: 'tutor', content: '看图：\n```svg\n<svg viewBox="0 0 680 120"></svg>\n```' }
    ]
  };
  mockTauri.mockInvoke('visualize_save_session', {
    projectPath: this.projectPath, session: this.visualizeSession
  });
  mockTauri.mockInvoke('persist_explanation', {
    projectPath: this.projectPath, chapter: '03-attention', conversation: this.conv
  });
});

steps.then('the concept record should carry the visualize part for resuming', function() {
  const hit = this.records.filter((r) => r.title === '位置编码');
  if (hit.length !== 1) {
    throw new Error(`同一概念应归并为一条记录，got ${hit.length} 条：${this.records.map((r) => r.title).join(', ')}`);
  }
  if (hit[0].rounds !== 2) throw new Error(`expected 2 rounds (解释1+画图1), got ${hit[0].rounds}`);
  if (hit[0].primary !== 'explain') throw new Error('起点是解释，主模式应为 explain');
  if (hit[0].modes !== '💡1 🖼️1') throw new Error(`mode summary wrong: ${hit[0].modes}`);
  const rec = hit[0].record;
  if (!rec.explain || !rec.visualize) throw new Error('record should carry both explain and visualize parts');
  if (rec.start_key !== '03-attention::位置编码') throw new Error(`start_key wrong: ${rec.start_key}`);
});

// ============================================
// Scenario：AI 回答里的数学公式渲染为 KaTeX（与主预览同方案）
// ============================================

// markdown-utils.escapeHtml 依赖 document.createElement 的 textContent→innerHTML
// 联动；本文件顶部的 makeEl 不联动（innerHTML 恒空串），数学场景内临时换成联动版。
function installLinkedCreateElement() {
  const prev = global.document.createElement;
  global.document.createElement = function (tag) {
    const el = prev(tag);
    let html = '';
    Object.defineProperty(el, 'textContent', {
      configurable: true,
      set(v) { html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    });
    Object.defineProperty(el, 'innerHTML', { configurable: true, get() { return html; } });
    return el;
  };
  return function restore() { global.document.createElement = prev; };
}

steps.when('the tutor bubble renders markdown containing math', function() {
  this._restoreCreate = installLinkedCreateElement();
  // 真实 vendor KaTeX（quirks mode 警告是 Node 无 doctype，浏览器不触发）
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    global.katex = require('../../dist/vendor/katex/katex.min.js');
  } finally {
    console.warn = origWarn;
  }
  const { markdownToHtml } = require('../../dist/scripts/markdown-utils');
  this.markdownToHtml = markdownToHtml;
  // 实爆案例（2026-09-22）：伴学面板 Torr→bar 换算，display + inline + 代码块混合
  this.rendered = markdownToHtml(
    '第一步，把炉压换算成 bar：\n\n' +
    '$$30\\ \\text{Torr} \\div 750 \\approx 0.040\\ \\text{bar}$$\n\n' +
    '第二步，$1\\ \\text{atm} = 1.01325\\ \\text{bar}$，数值上只差 1.3%。\n\n' +
    '示例：\n```js\nconst s = "$x^2$";\n```'
  );
});

steps.then('display and inline math should render via KaTeX with intact LaTeX', function() {
  const html = this.rendered;
  if (!html.includes('katex-display')) throw new Error(`display math not rendered: ${html.slice(0, 200)}`);
  if (!html.includes('class="katex"')) throw new Error('inline math not rendered');
  if (html.includes('katex-error')) throw new Error('katex render error leaked into bubble');
  if (html.includes('$$30')) throw new Error('raw $$ text survived unrendered');
});

steps.then('math inside code fences should stay as literal code', function() {
  if (!this.rendered.includes('<pre><code>')) throw new Error('fence should render as code block');
  if (!this.rendered.includes('$x^2$')) throw new Error('code content must stay literal');
});

steps.then('without katex the raw text should survive', function() {
  delete global.katex;
  const html = this.markdownToHtml('炉压 $x^2$ 左右');
  if (!html.includes('$x^2$')) throw new Error(`raw math text lost without katex: ${html}`);
  if (this._restoreCreate) { this._restoreCreate(); this._restoreCreate = null; }
});

// ============================================
// Scenario：AI 回答里的 SVG 围栏渲染为活图（🖼️ 画个图渲染通道）
// ============================================

steps.when('the tutor bubble renders markdown containing an svg fence', function() {
  this._restoreCreate = installLinkedCreateElement();
  const { markdownToHtml } = require('../../dist/scripts/markdown-utils');
  // 合法元素（title/rect/fill）+ 三类危险载荷（onload / script / foreignObject 套 onerror）
  this.rendered = markdownToHtml(
    '这是一张示意图：\n' +
    '```svg\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120" width="100%" onload="alert(1)">' +
    '<title>晶面示意</title>' +
    '<rect x="0" y="0" width="680" height="120" fill="#F7F5F0"/>' +
    '<script>alert(2)</script>' +
    '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(3)"></body></foreignObject>' +
    '</svg>\n' +
    '```\n' +
    '图后正文。'
  );
});

steps.then('the svg fence should render as live markup instead of a code block', function() {
  if (!this.rendered.includes('<svg')) {
    throw new Error(`svg fence did not render as live markup: ${this.rendered.slice(0, 200)}`);
  }
  if (this.rendered.includes('&lt;svg')) {
    throw new Error('svg was escaped —— 应还原为活图而非文本');
  }
  if (this.rendered.includes('<pre><code>')) {
    throw new Error('svg fence 被当成普通代码块渲染了');
  }
  // 合法内容必须保留（清洗不能误伤）
  if (!this.rendered.includes('<title>晶面示意</title>') || !this.rendered.includes('fill="#F7F5F0"')) {
    throw new Error(`合法 svg 内容丢失: ${this.rendered.slice(0, 200)}`);
  }
  if (!this.rendered.includes('图后正文。')) {
    throw new Error('围栏后的正文被吞');
  }
});

steps.then('script and event handlers inside the svg should be stripped', function() {
  if (/<script/i.test(this.rendered)) throw new Error('script survived svg sanitization');
  if (/onload|onerror/i.test(this.rendered)) throw new Error('event handler attribute survived');
  if (/<foreignObject/i.test(this.rendered)) {
    throw new Error('foreignObject survived —— 可内嵌任意 HTML 绕过 escape');
  }
  if (this._restoreCreate) { this._restoreCreate(); this._restoreCreate = null; }
});

steps.then('the bubble stylesheet should compact h1 and h2 for chat scale', function() {
  const css = fs.readFileSync(LEARNING_CSS, 'utf-8');
  if (!/\.socratic-bubble-md h1/.test(css)) {
    throw new Error('bubble h1 not styled — falls through to document-scale h1');
  }
  if (!/\.socratic-bubble-md h2/.test(css)) {
    throw new Error('bubble h2 not styled — falls through to document-scale h2');
  }
  // 压缩规则必须去掉全局 h1/h2 的下边框，否则气泡里出现文档级分隔线
  const block = css.match(/\.socratic-bubble-md h1[^{]*\{[\s\S]*?\}/);
  if (!block || !/border-bottom:\s*none/.test(block[0])) {
    throw new Error('bubble h1/h2 must drop the document underline');
  }
});

// ============================================
// Cleanup
// ============================================

steps._cleanup = function() {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  _tmpDirs = [];
};

module.exports = steps;
