#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程内容元素约束：engineering 域 + D 层硬校验（Sprint 20）
 *
 * 验证源文件内容约束（skill 三文件 + Rust/bridge/element_compliance 接线），仿 sprint19 模式：
 * 直接读真实源码断言关键约束存在，缺失即 throw。
 *
 * 行为层（element_compliance 校验 / element-repair / plan_prompt）由以下测试覆盖：
 * - cargo test --test element_compliance_test --test plan_prompt_test
 * - node tests/sprint20/unit/test_element_repair.js
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

const SKILL_DIR = path.join(__dirname, '../../src-tauri/skills/chapter-generation');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const PLAN_PROMPT_RS = path.join(__dirname, '../../src-tauri/src/plan_prompt.rs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const ELEMENT_COMPLIANCE_RS = path.join(__dirname, '../../src-tauri/src/element_compliance.rs');
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

steps.given('the real element_compliance source', function () {
  this.elementCompliance = read(ELEMENT_COMPLIANCE_RS);
});

steps.given('the real agent-bridge.mjs source', function () {
  this.agentBridge = read(AGENT_BRIDGE);
});

// ============================================
// PB20-1: engineering 域
// ============================================

steps.then('SKILL.md should define the engineering course type', function () {
  if (!this.skillMd.includes('engineering')) {
    throw new Error('SKILL.md missing engineering course type');
  }
  if (!this.skillMd.includes('工程')) {
    throw new Error('SKILL.md missing engineering (中文) label/说明');
  }
});

steps.then('SKILL.md should ban programming code blocks for engineering', function () {
  if (!this.skillMd.includes('禁止')) {
    throw new Error('SKILL.md missing ban keyword for engineering');
  }
  // engineering 与 humanities 共享"禁编程代码块"铁律；不得出现引导写代码的占位
  if (this.skillMd.includes('engineering') && !this.skillMd.includes('伪代码')) {
    throw new Error('SKILL.md missing pseudocode/编程 code-block ban shared with engineering');
  }
});

steps.then('SKILL.md should require real formulas for engineering', function () {
  if (!this.skillMd.includes('真公式')) {
    throw new Error('SKILL.md missing 真公式 requirement for engineering');
  }
  if (!this.skillMd.includes('伪公式')) {
    throw new Error('SKILL.md missing 伪公式 ban near formulas');
  }
});

steps.then('SKILL.md should require real industrial instances for engineering', function () {
  if (!this.skillMd.includes('工业实例')) {
    throw new Error('SKILL.md missing 工业实例 as engineering concrete-instance carrier');
  }
});

steps.then('SKILL.md should include engineering in the inference heuristic', function () {
  if (!this.skillMd.includes('engineering')) {
    throw new Error('engineering missing from inference heuristic');
  }
  if (!this.skillMd.includes('工艺')) {
    throw new Error('inference heuristic should include 工艺');
  }
});

steps.then('SKILL.md should have an engineering item in the MUST-VERIFY per-type block', function () {
  if (!this.skillMd.includes('MUST-VERIFY')) {
    throw new Error('SKILL.md missing MUST-VERIFY checklist');
  }
  if (!this.skillMd.includes('engineering')) {
    throw new Error('type-conditional MUST-VERIFY missing engineering row');
  }
});

// ============================================
// content-format
// ============================================

steps.then('the spec should be version 1.3', function () {
  if (!this.formatMd.includes('v1.3')) {
    throw new Error('content-format.md should be version 1.3');
  }
});

steps.then('the spec should have an engineering template branch', function () {
  if (!this.formatMd.includes('engineering')) {
    throw new Error('content-format.md missing engineering branch');
  }
});

steps.then('engineering branch should allow real formulas but no code blocks', function () {
  if (!this.formatMd.includes('真公式')) {
    throw new Error('engineering branch should allow real formulas');
  }
  if (!this.formatMd.includes('工业实例')) {
    throw new Error('engineering branch should use 工业实例 as concrete instance');
  }
  if (!this.formatMd.includes('禁止') || !this.formatMd.includes('代码块')) {
    throw new Error('engineering branch should ban programming code blocks');
  }
});

// ============================================
// 全链路 / D 层 / bridge
// ============================================

steps.then('build_plan_prompt should enumerate engineering', function () {
  if (!this.planPromptRs.includes('engineering')) {
    throw new Error('plan_prompt.rs build_plan_prompt missing engineering enum');
  }
});

steps.then('generate_chapters should accept engineering course_type', function () {
  // ai_agent 读 project.json 时必须接受 engineering，否则被过滤丢弃
  if (!this.aiAgentRs.includes('engineering')) {
    throw new Error('ai_agent.rs missing engineering in course_type accept filter');
  }
});

steps.then('generate_chapters should persist engineering course_type', function () {
  if (!this.libRs.includes('course_type')) {
    throw new Error('lib.rs should persist course_type');
  }
});

steps.then('element_compliance should expose check_chapter', function () {
  if (!this.elementCompliance.includes('check_chapter')) {
    throw new Error('element_compliance.rs missing check_chapter');
  }
});

steps.then('generate_chapters should scan element violations and trigger element-repair', function () {
  if (!this.aiAgentRs.includes('element')) {
    throw new Error('ai_agent.rs missing element-compliance wiring');
  }
  if (!this.aiAgentRs.includes('element-repair')) {
    throw new Error('ai_agent.rs missing element-repair trigger');
  }
});

steps.then('agent-bridge should implement element-repair', function () {
  if (!this.agentBridge.includes('element-repair')) {
    throw new Error('agent-bridge.mjs missing element-repair stage');
  }
});

steps.then('element-repair should instruct only fixing flagged code blocks', function () {
  const idx = this.agentBridge.indexOf('element-repair');
  const seg = this.agentBridge.slice(Math.max(0, idx - 100), idx + 1200);
  if (!seg.includes('只') && !seg.includes('仅')) {
    throw new Error('element-repair prompt should limit fixes to flagged code blocks');
  }
  if (!seg.includes('原样保留') && !seg.includes('不动')) {
    throw new Error('element-repair prompt should keep the rest unchanged');
  }
});

steps.then('examples should include an engineering fragment without code blocks', function () {
  if (!this.examplesMd.includes('engineering')) {
    throw new Error('examples.md missing engineering fragment');
  }
});

module.exports = steps;
