#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程案例研习（Sprint 17）
 *
 * 真实文件系统 + 真实前端模块：
 * - mock-tauri 真实 fs（case_study_chat/save/list 三命令）
 * - 静态接线检查（skill / agent-bridge / lib.rs / index.html）
 */

const fs = require('fs');
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


const steps = new StepRegistry();

const SKILL_MD = path.join(__dirname, '../../src-tauri/skills/typora-course-case-study/SKILL.md');
const BRIDGE = path.join(__dirname, '../../agent-bridge.mjs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MAIN_JS = path.join(__dirname, '../../dist/scripts/main.js');
const MODE_INTEGRATION_JS = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
const LEARNING_CSS = path.join(__dirname, '../../dist/styles/learning.css');
const MAIN_CSS = path.join(__dirname, '../../dist/styles/main.css');

// ============================================
// Given
// ============================================
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
});

// ============================================
// UX 修正（2026-08-11）：原地触发 + 防遮挡
// （AI 伴学统一入口后：气泡收敛为单一 ✨ 按钮，案例研习走三选菜单的
//  「📋 举个例子」→ openAICompanion(text, 'example')，不再有独立 📋 按钮）
// ============================================
steps.then('the selection toolbar should offer case study via the companion menu', function() {
  if (!this.mainJs.includes('id="aiCompanionBtn"')) {
    throw new Error('selection toolbar missing aiCompanionBtn');
  }
  if (!this.mainJs.includes('data-mode="example"')) {
    throw new Error('companion menu missing example mode');
  }
});

steps.then('the companion button visibility should be gated on course mode', function() {
  const fnIdx = this.mainJs.indexOf('function showSelectionToolbar');
  if (fnIdx < 0) throw new Error('main.js missing showSelectionToolbar');
  const body = this.mainJs.slice(fnIdx, fnIdx + 1200);
  if (!body.includes('aiCompanionBtn')) {
    throw new Error('showSelectionToolbar does not toggle aiCompanionBtn');
  }
  if (!body.includes("AppWorkspace.isIn('course')")) {
    throw new Error('companion button visibility not gated on course mode');
  }
});

steps.then('the example mode click should call openAICompanion with the selected text', function() {
  const btnIdx = this.mainJs.indexOf("querySelector('#aiCompanionBtn')");
  if (btnIdx < 0) throw new Error('aiCompanionBtn not bound in selection toolbar');
  const body = this.mainJs.slice(btnIdx, btnIdx + 1600);
  if (!body.includes('openAICompanion(text, mode)')) {
    throw new Error('companion menu click does not call openAICompanion(text, mode)');
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

steps.then('the cornell sidebar should not contain an explain button', function() {
  const tplIdx = this.modeIntegration.indexOf('cornell-sidebar-actions');
  if (tplIdx < 0) throw new Error('mode-integration missing actions row');
  const actionsBlock = this.modeIntegration.slice(tplIdx, tplIdx + 400);
  if (actionsBlock.includes('cornellExplainBtn')) {
    throw new Error('explain button still in sidebar actions row');
  }
});

steps.then('the case study sidebar entry should open the unified companion history', function() {
  // AI 伴学统一入口后：侧栏按钮收敛为「🕘 伴学记录」，统一列出
  // 📋 举例（case-studies）与 💬 我有话说（own-voices），点击续聊
  const idx = this.modeIntegration.indexOf("getElementById('companionHistoryBtn')");
  if (idx < 0) throw new Error('companionHistoryBtn binding missing');
  const body = this.modeIntegration.slice(idx, idx + 400);
  if (!body.includes('openCompanionHistory')) {
    throw new Error('companionHistoryBtn does not open unified history');
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
  // 案例研习面板已并入 AI 伴学统一面板：流式监听由它承担
  const panelSrc = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/learning/ai-companion-modal.js'), 'utf-8');
  if (!panelSrc.includes("eventName: 'case-study-event'")) {
    throw new Error('ai-companion-modal does not listen case-study-event');
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

// ============================================
// 气泡代码块配色回归（2026-09-17 实爆）
//
// 现场：案例研习（及苏格拉底）气泡里，白天主题下代码块几乎不可读、
// 深色主题正常。根因是 .socratic-bubble-md pre 用了半透明灰底
// rgba(127,127,127,0.12)（白天合成出浅底），而代码文字色来自
// main.css `pre code { color: #cdd6f4 }`——那是专为深底设计的浅字。
// 本步骤不锁死具体色值，只验证「气泡代码块底色不透明 + 与文字色对比度
// 达到 WCAG AA」，因此换色方案也能通过、配色写错则必红。
// ============================================

function parseHexColor(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

function parseRgbColor(v) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(String(v).trim());
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function parseColor(v) { return parseHexColor(v) || parseRgbColor(v); }

/** WCAG 2.x 相对亮度 */
function relativeLuminance(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 取 CSS 声明块里某属性的值（同一 selector 多次出现时取最后一条） */
function declaredValue(css, selectorSource, prop, flags) {
  // 必须先剔除注释：注释里可能出现 `}`（例如 `pre { background: #1e1e2e }`），
  // 会让 [^}]* 提前截断声明块 → 取不到属性 → 测试假绿。
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(selectorSource + '\\s*\\{([^}]*)\\}', flags || 'g');
  let m, last = null;
  while ((m = re.exec(clean)) !== null) last = m[1];
  if (last === null) return null;
  const pm = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(last);
  return pm ? pm[1].trim() : null;
}

steps.then('the case study bubble code blocks should be readable in both themes', function() {
  const mainCss = fs.readFileSync(MAIN_CSS, 'utf-8');

  // 代码文字色：正文代码块的单一事实源 main.css `pre code { color: #cdd6f4 }`
  const codeColorRaw = declaredValue(mainCss, '^pre code', 'color', 'gm');
  if (!codeColorRaw) throw new Error('main.css 未定义 pre code 文字色，气泡代码块的配色契约失效');
  const codeColor = parseColor(codeColorRaw);
  if (!codeColor) throw new Error(`无法解析 pre code 文字色: ${codeColorRaw}`);

  // 气泡代码块有效底色：优先 .socratic-bubble-md pre，未声明则回落正文 pre
  const bubbleBgRaw = declaredValue(this.learningCss, '\\.socratic-bubble-md pre(?![\\w-])', 'background')
    || declaredValue(mainCss, '^pre(?![\\w\\[.:])', 'background', 'gm');
  if (!bubbleBgRaw) throw new Error('未找到气泡代码块的底色声明');
  const bubbleBg = parseColor(bubbleBgRaw);
  if (!bubbleBg) throw new Error(`无法解析气泡代码块底色: ${bubbleBgRaw}`);

  // 半透明底色会与气泡背景合成：白天主题近白底、深色主题近暗底，
  // 不可能同时安全 → 直接判定回归（这正是本次 bug 的形态）
  if (bubbleBg.a < 1) {
    throw new Error(
      `气泡代码块底色是半透明的（${bubbleBgRaw}）：` +
      '会随主题合成出不同底色，白天主题下与浅色代码文字对比不足。' +
      '应使用与正文代码块一致的不透明深色底。'
    );
  }

  const ratio = contrastRatio(bubbleBg, codeColor);
  if (ratio < 4.5) {
    throw new Error(
      `气泡代码块对比度仅 ${ratio.toFixed(2)}:1（底 ${bubbleBgRaw} / 字 ${codeColorRaw}），` +
      '低于 WCAG AA 4.5:1 —— 白天主题下代码不可读。'
    );
  }
});


module.exports = steps;
