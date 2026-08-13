#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程完成生成 slide 总结（Sprint 15）
 *
 * 真实文件系统 + 真实前端模块：
 * - CourseSummary 纯函数（require dist/scripts/learning/course-summary）
 * - slides-splitter 结构解析（require tests/shared/slides-splitter）
 * - ChapterStatusManager（require dist/scripts/learning/progress-tracker）
 * - mock-tauri 真实 fs（验证 summaryExists）
 * - dist/index.html + main.js 静态标记（模块加载 + 放映入口暴露）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StepRegistry } = require('../shared/runner');
require('./mock-tauri'); // sets global.window.__TAURI__ (real fs)

const CourseSummary = require('../../dist/scripts/learning/course-summary');
const { parseMarkdownStructure } = require('../shared/slides-splitter');
const { ChapterStatusManager } = require('../../dist/scripts/learning/progress-tracker');

const steps = new StepRegistry();

const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MAIN_JS = path.join(__dirname, '../../dist/scripts/main.js');
const COURSE_SUMMARY_JS = path.join(__dirname, '../../dist/scripts/learning/course-summary.js');

const SUMMARY_FILE = CourseSummary.SUMMARY_FILE;

let _tmpDirs = [];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'cs-'));
  _tmpDirs.push(d);
  return d;
}

/** 一份带 --- 分隔的演示总结（模拟 agent 写盘内容）。 */
const MOCK_SUMMARY_MD = `# 扩散模型课程总结

用直觉走进生成之美

---

## 主题一：生成模型基础

- 核心概念 A
- 核心概念 B

---

## 主题二：数学原理

- 前向过程
- 反向过程

---

## 主题三：架构与训练

- UNet
- 噪声调度

---

## 主题四：应用与前沿

- 文生图
- 加速采样

---

## 精华提炼

> 如果只能记住三件事

1. 扩散就是逐步加噪再学会去噪
2. 训练目标是预测噪声
3. 采样是迭代反演

---

## Case Study：Stable Diffusion

**情境**：Stability AI 要做消费级文生图。

**应用**：潜空间扩散大幅降低算力门槛。

**启示**：好架构让理论落地。

---

## 学习回顾

1. 扩散模型
2. 噪声调度
3. UNet
`;

// ============================================
// Given
// ============================================
steps.given('a completed course project', function() {
  this.projectPath = tmpdir('cs-done-');
  this.manager = new ChapterStatusManager([
    { title: '一', duration_minutes: 10, concepts: [] },
    { title: '二', duration_minutes: 10, concepts: [] },
    { title: '三', duration_minutes: 10, concepts: [] }
  ]);
  this.manager.chapters.forEach((ch) => { ch.status = 'completed'; });
  this.offered = false;
});

steps.given('a course project with pending chapters', function() {
  this.projectPath = tmpdir('cs-pend-');
  this.manager = new ChapterStatusManager([
    { title: '一', duration_minutes: 10, concepts: [] },
    { title: '二', duration_minutes: 10, concepts: [] }
  ]);
  this.manager.chapters[0].status = 'completed';
  this.manager.chapters[1].status = 'not_generated';
  this.offered = false;
});

steps.given('the summary offer was already shown this session', function() {
  this.offered = true;
});

steps.given('no summary file exists', function() {
  this.summaryFileExists = false;
});

steps.given('a summary file already exists', function() {
  this.summaryFileExists = true;
});

steps.given('an AI-written summary markdown with --- separators', function() {
  this.summaryMd = MOCK_SUMMARY_MD;
});

steps.given('the course summary file was written to disk', function() {
  this.projectPath = tmpdir('cs-write-');
  fs.writeFileSync(path.join(this.projectPath, SUMMARY_FILE), MOCK_SUMMARY_MD, 'utf-8');
});

steps.given('the real index.html markup', function() {
  this.html = fs.readFileSync(INDEX_HTML, 'utf-8');
  this.mainJs = fs.readFileSync(MAIN_JS, 'utf-8');
});

steps.given('the real bundled skills directory', function() {
  this.summarySkillDir = path.join(__dirname, '../../src-tauri/skills/typora-course-summary');
  this.agentBridge = fs.readFileSync(path.join(__dirname, '../../agent-bridge.mjs'), 'utf-8');
});

// ============================================
// When
// ============================================
steps.when('the summary offer decision is evaluated', async function() {
  const exists = this.summaryFileExists === true
    ? true
    : await CourseSummary.summaryExists(this.projectPath);
  this.decision = CourseSummary.shouldOfferSummary(this.manager, this.offered, exists);
});

steps.when('the summary is parsed as slide structure', function() {
  this.groups = parseMarkdownStructure(this.summaryMd);
});

steps.when('summary existence is checked', async function() {
  this.summaryExistsResult = await CourseSummary.summaryExists(this.projectPath);
});

// ============================================
// Then
// ============================================
steps.then('a summary offer should be shown', function() {
  if (this.decision !== true) {
    throw new Error(`Expected offer=true, got ${this.decision}`);
  }
});

steps.then('no summary offer should be shown', function() {
  if (this.decision !== false) {
    throw new Error(`Expected offer=false, got ${this.decision}`);
  }
});

steps.then('it should yield at least 6 slide groups', function() {
  if (!Array.isArray(this.groups) || this.groups.length < 6) {
    throw new Error(`Expected ≥6 slide groups, got ${Array.isArray(this.groups) ? this.groups.length : 'not-array'}`);
  }
});

steps.then('the summary should contain essence and case study pages without a meta design page', function() {
  for (const section of ['## 精华提炼', '## Case Study']) {
    if (!this.summaryMd.includes(section)) {
      throw new Error(`Summary missing section: ${section}`);
    }
  }
  // 设计思路应化进主题页脉络，禁止单设一页直接谈论设计（2026-08-12 用户反馈）
  if (this.summaryMd.includes('## 课程设计思路')) {
    throw new Error('Summary must not have a standalone 课程设计思路 page');
  }
});

steps.then('the summary file should exist', function() {
  if (this.summaryExistsResult !== true) {
    throw new Error('Expected summary file to exist on disk');
  }
});

steps.then('the page should load the course summary module', function() {
  if (!this.html.includes('scripts/learning/course-summary.js')) {
    throw new Error('index.html does not load course-summary.js');
  }
  if (!fs.existsSync(COURSE_SUMMARY_JS)) {
    throw new Error('dist/scripts/learning/course-summary.js missing on disk');
  }
  if (typeof CourseSummary.isCourseCompleted !== 'function') {
    throw new Error('course-summary.js does not export isCourseCompleted');
  }
});

steps.then('the app should expose openSlides and showToast', function() {
  if (!this.mainJs.includes('openSlides,')) {
    throw new Error('main.js does not expose openSlides on window.TyporaNext');
  }
  if (!this.mainJs.includes('window.showToast = showToast')) {
    throw new Error('main.js does not expose window.showToast');
  }
});

steps.then('a typora-course-summary skill should exist with valid frontmatter', function() {
  const skillFile = path.join(this.summarySkillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error('src-tauri/skills/typora-course-summary/SKILL.md missing on disk');
  }
  const content = fs.readFileSync(skillFile, 'utf-8');
  if (!content.includes('name: typora-course-summary')) {
    throw new Error('SKILL.md missing name frontmatter');
  }
  if (!content.includes('99-课程总结.md')) {
    throw new Error('SKILL.md does not reference the summary output file');
  }
  if (!content.includes('MUST-VERIFY')) {
    throw new Error('SKILL.md missing MUST-VERIFY checklist');
  }
  // 2026-08-12 总结升级：脉络即设计 + 精华提炼 + Case Study 三段约束
  for (const section of ['脉络', '精华提炼', 'Case Study']) {
    if (!content.includes(section)) {
      throw new Error(`SKILL.md missing section constraint: ${section}`);
    }
  }
  if (!content.includes('禁止**单设一页直接解释课程设计')) {
    throw new Error('SKILL.md must forbid a standalone course-design page');
  }
});

steps.then('the agent bridge should reference it by name', function() {
  if (!this.agentBridge.includes('typora-course-summary skill')) {
    throw new Error('agent-bridge.mjs does not reference typora-course-summary skill');
  }
});

steps._cleanup = function() {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  _tmpDirs = [];
};

module.exports = steps;
