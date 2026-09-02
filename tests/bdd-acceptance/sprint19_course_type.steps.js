#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程类型自适应章节模板（Sprint 19）
 *
 * 验证源文件内容约束（skill 三文件 + Rust/bridge 接线），仿 sprint15 模式：
 * 直接读真实源码断言关键约束存在，缺失即 throw。
 *
 * 行为层（prompt 构造 / 计划解析 / 递归拷贝）由以下测试覆盖：
 * - node tests/sprint19/unit/test_chapter_prompt.js
 * - cargo test --test plan_prompt_test --test skills_bundle_test
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

const SKILL_DIR = path.join(__dirname, '../../src-tauri/skills/chapter-generation');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const PLAN_PROMPT_RS = path.join(__dirname, '../../src-tauri/src/plan_prompt.rs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const AGENT_BRIDGE = path.join(__dirname, '../../agent-bridge.mjs');

function read(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`source file missing on disk: ${p}`);
  }
  return fs.readFileSync(p, 'utf-8');
}

// ============================================
// Given
// ============================================

steps.given('the bundled chapter-generation skill', function () {
  this.skillMd = read(path.join(SKILL_DIR, 'SKILL.md'));
});

steps.given('the chapter-generation content-format spec', function () {
  this.formatMd = read(path.join(SKILL_DIR, 'references/content-format.md'));
});

steps.given('the chapter-generation examples reference', function () {
  this.examplesMd = read(path.join(SKILL_DIR, 'references/examples.md'));
});

steps.given('the real ai_agent.rs and lib.rs sources', function () {
  this.aiAgentRs = read(AI_AGENT_RS);
  this.planPromptRs = read(PLAN_PROMPT_RS);
  this.libRs = read(LIB_RS);
});

steps.given('the real agent-bridge.mjs source', function () {
  this.agentBridge = read(AGENT_BRIDGE);
});

// ============================================
// Then — SKILL.md 类型判定与分支
// ============================================

steps.then('SKILL.md should have a course-type decision section', function () {
  if (!this.skillMd.includes('课程类型判定')) {
    throw new Error('SKILL.md missing 课程类型判定 section');
  }
  // 一致性铁律：全课程只用一个类型
  if (!this.skillMd.includes('一致性铁律')) {
    throw new Error('SKILL.md missing course-type consistency rule');
  }
});

steps.then('SKILL.md should define all three course types', function () {
  for (const t of ['technical', 'humanities', 'hybrid']) {
    if (!this.skillMd.includes(t)) {
      throw new Error(`SKILL.md missing course type: ${t}`);
    }
  }
  // prompt 缺类型时的推断兜底（旧项目）
  if (!this.skillMd.includes('推断')) {
    throw new Error('SKILL.md missing inference fallback for absent course_type');
  }
});

steps.then('SKILL.md should forbid filler pseudocode for humanities', function () {
  if (!this.skillMd.includes('禁止凑数伪代码')) {
    throw new Error('SKILL.md missing filler-pseudocode ban for humanities');
  }
});

steps.then('SKILL.md should require concrete work examples for humanities', function () {
  if (!this.skillMd.includes('具体作品实例')) {
    throw new Error('SKILL.md missing concrete work examples requirement');
  }
  // 实例须落到乐章/时间点/年代/出处级别的具体度
  if (!this.skillMd.includes('乐章') || !this.skillMd.includes('时间点')) {
    throw new Error('humanities examples must be specific to movement/time-point level');
  }
});

steps.then('SKILL.md should contain a mermaid type-selection guide', function () {
  if (!this.skillMd.includes('Mermaid 图示选型表')) {
    throw new Error('SKILL.md missing mermaid type-selection guide');
  }
  // 时间线用 timeline、体系用 mindmap（修巴赫生平被画成 flowchart 的形态错配）
  if (!this.skillMd.includes('`timeline`')) {
    throw new Error('selection guide should map chronology to timeline');
  }
  if (!this.skillMd.includes('`mindmap`')) {
    throw new Error('selection guide should map taxonomy to mindmap');
  }
});

// ============================================
// Then — MUST-VERIFY 分化
// ============================================

steps.then('the checklist should have a universal block', function () {
  if (!this.skillMd.includes('MUST-VERIFY')) {
    throw new Error('SKILL.md missing MUST-VERIFY checklist');
  }
  if (!this.skillMd.includes('通用项')) {
    throw new Error('checklist missing universal block (通用项)');
  }
});

steps.then('the checklist should have per-type conditional items', function () {
  if (!this.skillMd.includes('类型条件项')) {
    throw new Error('checklist missing per-type conditional block (类型条件项)');
  }
});

// ============================================
// Then — content-format.md
// ============================================

steps.then('the spec should be version 1.2', function () {
  // Sprint 19 引入 v1.2；Sprint 20 升级到 v1.3（新增 engineering 域）。
  // 同时含 v1.2 即视为通过（向后兼容断言，由 sprint20 独立验收 v1.3）。
  if (!this.formatMd.includes('v1.2')) {
    throw new Error('content-format.md missing v1.2 version marker');
  }
  if (!this.formatMd.includes('2026-08-22 | v1.2')) {
    throw new Error('content-format.md missing v1.2 changelog row');
  }
});

steps.then('the spec should parameterize math and code rules', function () {
  if (!this.formatMd.includes('人文课')) {
    throw new Error('content-format.md §1 not parameterized for humanities');
  }
  if (!this.formatMd.includes('禁止为凑数虚构代码块')) {
    throw new Error('content-format.md should ban filler code blocks for humanities');
  }
});

// ============================================
// Then — Rust 全链路接线
// ============================================

steps.then('build_plan_prompt should request course_type', function () {
  if (!this.planPromptRs.includes('course_type')) {
    throw new Error('plan_prompt.rs build_plan_prompt missing course_type');
  }
});

steps.then('create_learning_project should persist course_type', function () {
  if (!this.libRs.includes('course_type')) {
    throw new Error('lib.rs create_learning_project missing course_type persistence');
  }
});

steps.then('generate_chapters should inject course_type into bridge args', function () {
  if (!this.aiAgentRs.includes('args["course_type"]')) {
    throw new Error('generate_chapters missing course_type injection into bridge args');
  }
  // project.json 是唯一权威来源（前端 outline 只带 chapters）
  if (!this.aiAgentRs.includes('.learning')) {
    throw new Error('course_type should be read from .learning/project.json');
  }
});

// ============================================
// Then — bridge
// ============================================

steps.then('buildChapterPrompt should emit course_type conditionally', function () {
  if (!this.agentBridge.includes('buildChapterPrompt')) {
    throw new Error('agent-bridge.mjs missing buildChapterPrompt');
  }
  if (!this.agentBridge.includes('courseTypeLine')) {
    throw new Error('buildChapterPrompt should emit course_type line only when present');
  }
});

steps.then('fresh sessions should get skill refs inlined', function () {
  if (!this.agentBridge.includes('collectChapterSkillRefs')) {
    throw new Error('agent-bridge.mjs missing collectChapterSkillRefs helper');
  }
  // 无 session 时 prompt 前拼参考资料（修"session 里已读过"为假的 bug）
  if (!this.agentBridge.includes("args.session_id ? '' : collectChapterSkillRefs(project_path)")) {
    throw new Error('fresh-session mode should inline skill refs into the chapter prompt');
  }
});

// ============================================
// Then — 递归拷贝
// ============================================

steps.then('the skills copy should be recursive', function () {
  if (!this.aiAgentRs.includes('pub use crate::skills_bundle')) {
    throw new Error('ai_agent.rs should re-export skills_bundle (recursive copy module)');
  }
  const skillsBundle = read(path.join(__dirname, '../../src-tauri/src/skills_bundle.rs'));
  if (!skillsBundle.includes('fn copy_dir_recursive')) {
    throw new Error('skills_bundle.rs missing recursive copy (references/ never reached projects)');
  }
});

// ============================================
// Then — examples.md
// ============================================

steps.then('examples should be labeled as a technical-course example', function () {
  if (!this.examplesMd.includes('technical') || !this.examplesMd.includes('技术课')) {
    throw new Error('examples.md should label the worked example as technical-course');
  }
});

steps.then('examples should include a humanities fragment with timeline', function () {
  if (!this.examplesMd.includes('humanities') || !this.examplesMd.includes('人文课')) {
    throw new Error('examples.md missing humanities fragment');
  }
  if (!this.examplesMd.includes('timeline')) {
    throw new Error('humanities fragment should demo the timeline diagram');
  }
  if (!this.examplesMd.includes('具体作品实例')) {
    throw new Error('humanities fragment should demo concrete work examples');
  }
});

module.exports = steps;
