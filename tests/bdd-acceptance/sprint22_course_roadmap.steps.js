#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 结课 roadmap + 总结删除（Sprint 22）
 *
 * 仿 sprint21 模式：直接读真实源码断言接线存在，缺失即 throw；
 * 删除验收用反向断言（文件不存在 / 源码无引用）。
 *
 * 行为层由 cargo test --test roadmap_prompt_test 与
 * tests/sprint22/unit/test_course_roadmap.js 覆盖。
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

const SRC = path.join(__dirname, '../../src-tauri/src');
const DIST = path.join(__dirname, '../../dist');
const REPO = path.join(__dirname, '../..');

function read(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`source file missing on disk: ${p}`);
  }
  return fs.readFileSync(p, 'utf-8');
}

// ============================================
// Given
// ============================================

steps.given('the real roadmap_prompt source', function () {
  this.roadmapPromptRs = read(path.join(SRC, 'roadmap_prompt.rs'));
});

steps.given('the real ai_agent.rs source', function () {
  this.aiAgentRs = read(path.join(SRC, 'ai_agent.rs'));
});

steps.given('the real lib.rs source', function () {
  this.libRs = read(path.join(SRC, 'lib.rs'));
});

steps.given('the real frontend sources for roadmap', function () {
  this.indexHtml = read(path.join(DIST, 'index.html'));
  this.roadmapJs = read(path.join(DIST, 'scripts/learning/course-roadmap.js'));
  this.dashboardJs = read(path.join(DIST, 'scripts/learning/knowledge-graph-dashboard.js'));
  this.projectResumeJs = read(path.join(DIST, 'scripts/learning/project-resume.js'));
  this.projectManagerJs = read(path.join(DIST, 'scripts/learning/project-manager.js'));
  this.learningCss = read(path.join(DIST, 'styles/learning.css'));
});

// ============================================
// PB22-1: 后端
// ============================================

steps.then('it should expose build_roadmap_prompt and parse_roadmap_response', function () {
  if (!this.roadmapPromptRs.includes('pub fn build_roadmap_prompt')) {
    throw new Error('roadmap_prompt.rs missing build_roadmap_prompt');
  }
  if (!this.roadmapPromptRs.includes('pub fn parse_roadmap_response')) {
    throw new Error('roadmap_prompt.rs missing parse_roadmap_response');
  }
});

steps.then('the prompt should require evidence-based reasons', function () {
  if (!this.roadmapPromptRs.includes('点名具体依据')) {
    throw new Error('roadmap prompt must require reason 点名具体依据');
  }
});

steps.then('parsing should normalize levels and cap at three directions', function () {
  if (!this.roadmapPromptRs.includes('"intermediate".to_string()')) {
    throw new Error('parse should default illegal level to intermediate');
  }
  if (!this.roadmapPromptRs.includes('out.len() >= 3')) {
    throw new Error('parse should cap directions at 3');
  }
});

steps.then('generate_roadmap should cache to roadmap.json under .learning', function () {
  if (!this.aiAgentRs.includes('pub async fn generate_roadmap')) {
    throw new Error('ai_agent.rs missing generate_roadmap command');
  }
  if (!this.aiAgentRs.includes('roadmap.json')) {
    throw new Error('generate_roadmap should cache to .learning/roadmap.json');
  }
});

steps.then('regenerate with exclusion accumulation when intent is present', function () {
  const fnIdx = this.aiAgentRs.indexOf('pub async fn generate_roadmap');
  const seg = this.aiAgentRs.slice(fnIdx, fnIdx + 4000);
  if (!seg.includes('excluded_goals')) {
    throw new Error('generate_roadmap should accumulate excluded_goals');
  }
  if (!seg.includes('intent.is_none()')) {
    throw new Error('cache hit path should require intent None');
  }
});

steps.then('it should use a direct ureq call with both providers', function () {
  const fnIdx = this.aiAgentRs.indexOf('pub async fn generate_roadmap');
  const nextFn = this.aiAgentRs.indexOf('pub async fn', fnIdx + 10);
  const seg = this.aiAgentRs.slice(fnIdx, nextFn > 0 ? nextFn : fnIdx + 8000);
  if (!seg.includes('ureq::post')) {
    throw new Error('generate_roadmap should call LLM via ureq (no agent loop)');
  }
  if (!seg.includes('AiProvider::Anthropic') || !seg.includes('AiProvider::Openai')) {
    throw new Error('generate_roadmap should support both providers');
  }
});

steps.then('generate_roadmap command should be registered', function () {
  if (!this.libRs.includes('ai_agent::generate_roadmap')) {
    throw new Error('lib.rs should register generate_roadmap in invoke_handler');
  }
});

steps.then('roadmap_prompt module should be declared', function () {
  if (!this.libRs.includes('pub mod roadmap_prompt;')) {
    throw new Error('lib.rs missing pub mod roadmap_prompt');
  }
});

// ============================================
// PB22-2: 前端
// ============================================

steps.then('index.html should load course-roadmap.js', function () {
  if (!this.indexHtml.includes('scripts/learning/course-roadmap.js')) {
    throw new Error('index.html missing course-roadmap.js script tag');
  }
});

steps.then('the dashboard should render the roadmap section only for completed courses', function () {
  if (!this.dashboardJs.includes('createRoadmapSection')) {
    throw new Error('dashboard missing createRoadmapSection integration');
  }
  const idx = this.dashboardJs.indexOf('createRoadmapSection');
  const seg = this.dashboardJs.slice(Math.max(0, idx - 300), idx);
  if (!seg.includes('data.courseCompleted') || !seg.includes('data.projectPath')) {
    throw new Error('roadmap section should be gated on courseCompleted + projectPath');
  }
});

steps.then('project-resume should pass projectPath to the dashboard', function () {
  const matches = this.projectResumeJs.split('projectPath: basePath').length - 1;
  if (matches < 2) {
    throw new Error(`project-resume.js should pass projectPath in both dashboard.show() calls (found ${matches})`);
  }
});

steps.then('card click should prefill the create dialog without submitting', function () {
  if (!this.dashboardJs.includes('openWithPrefill')) {
    throw new Error('dashboard onSelectDirection should call LearningProject.openWithPrefill');
  }
  if (!this.projectManagerJs.includes('openWithPrefill: openDialogWithPrefill')) {
    throw new Error('project-manager.js should export openWithPrefill');
  }
  if (!this.projectManagerJs.includes('snapHours')) {
    throw new Error('prefill should snap hours to select options');
  }
  // 不自动提交：预填路径不得调用 plan/transitionTo('planning')
  const fnIdx = this.projectManagerJs.indexOf('function openDialogWithPrefill');
  const seg = this.projectManagerJs.slice(fnIdx, fnIdx + 1200);
  if (seg.includes('plan_course') || seg.includes("transitionTo('planning')")) {
    throw new Error('prefill must NOT auto-submit');
  }
});

steps.then('course-roadmap.js should offer reshuffle and three intent chips', function () {
  if (!this.roadmapJs.includes("'reshuffle'")) {
    throw new Error('missing 换一批 reshuffle');
  }
  for (const id of ["'harder'", "'gentler'", "'different'"]) {
    if (!this.roadmapJs.includes(id)) {
      throw new Error(`missing intent chip ${id}`);
    }
  }
});

steps.then('styles for roadmap cards should exist', function () {
  for (const cls of ['.roadmap-section', '.roadmap-card', '.roadmap-chip']) {
    if (!this.learningCss.includes(cls)) {
      throw new Error(`learning.css missing ${cls}`);
    }
  }
});

// ============================================
// PB22-3: 课程总结删除（反向断言）
// ============================================

steps.then('generate_summary should not be registered', function () {
  if (this.libRs.includes('generate_summary')) {
    throw new Error('lib.rs still references generate_summary');
  }
});

steps.then('generate_summary should not be defined', function () {
  if (this.aiAgentRs.includes('generate_summary')) {
    throw new Error('ai_agent.rs still defines generate_summary');
  }
});

steps.then('the deleted summary files should be gone from disk', function () {
  const gone = [
    path.join(DIST, 'scripts/learning/course-summary.js'),
    path.join(REPO, 'src-tauri/skills/typora-course-summary'),
    path.join(REPO, 'tests/bdd-acceptance/sprint15_course_summary.steps.js'),
  ];
  for (const p of gone) {
    if (fs.existsSync(p)) {
      throw new Error(`deleted summary artifact still exists: ${p}`);
    }
  }
  const bridge = read(path.join(REPO, 'agent-bridge.mjs'));
  if (bridge.includes('generateSummary')) {
    throw new Error('agent-bridge.mjs still has generateSummary');
  }
});

steps.then('no frontend file should reference course-summary', function () {
  const html = read(path.join(DIST, 'index.html'));
  if (html.includes('course-summary.js')) {
    throw new Error('index.html still references course-summary.js');
  }
  const scriptsDir = path.join(DIST, 'scripts');
  const stack = [scriptsDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (fs.readFileSync(full, 'utf-8').includes('CourseSummary')) {
        throw new Error(`${full} still references CourseSummary`);
      }
    }
  }
});

module.exports = steps;
