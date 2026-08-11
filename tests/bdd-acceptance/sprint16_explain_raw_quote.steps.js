#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 划词解释截断修复（Sprint 16 附加）
 *
 * 行为层在 Rust（cargo test --test explain_parse_test）；
 * 本层验证：① bundled explanation skill 的半角引号禁令（源头预防）
 *          ② parse_explain_response → explain_parse 模块接线（防回归）。
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

const SKILL_MD = path.join(__dirname, '../../src-tauri/skills/explanation/SKILL.md');
const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');
const EXPLAIN_PARSE_RS = path.join(__dirname, '../../src-tauri/src/explain_parse.rs');

// ============================================
// Given
// ============================================
steps.given('the real bundled explanation skill', function() {
  if (!fs.existsSync(SKILL_MD)) {
    throw new Error('src-tauri/skills/explanation/SKILL.md missing on disk');
  }
  this.skillContent = fs.readFileSync(SKILL_MD, 'utf-8');
});

steps.given('the real ai_agent.rs source', function() {
  this.aiAgentRs = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  this.libRs = fs.readFileSync(LIB_RS, 'utf-8');
});

// ============================================
// Then
// ============================================
steps.then('the skill should forbid raw ASCII double quotes in output text', function() {
  if (!this.skillContent.includes('禁止半角双引号')) {
    throw new Error('explanation SKILL.md missing 禁止半角双引号 constraint');
  }
});

steps.then('parse_explain_response should delegate to explain_parse', function() {
  if (!fs.existsSync(EXPLAIN_PARSE_RS)) {
    throw new Error('src-tauri/src/explain_parse.rs missing on disk');
  }
  const fnIdx = this.aiAgentRs.indexOf('pub fn parse_explain_response');
  if (fnIdx < 0) {
    throw new Error('ai_agent.rs missing parse_explain_response');
  }
  const callIdx = this.aiAgentRs.indexOf('explain_parse::parse_explain_output', fnIdx);
  if (callIdx < 0) {
    throw new Error('parse_explain_response does not delegate to explain_parse::parse_explain_output');
  }
});

steps.then('lib.rs should register the explain_parse module', function() {
  if (!/pub mod explain_parse;/.test(this.libRs)) {
    throw new Error('lib.rs does not register pub mod explain_parse');
  }
});

module.exports = steps;
