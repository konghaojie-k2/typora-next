#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Sprint 5 BDD Runner
 * Runs ONLY sprint5_mermaid_apply_fix.feature against sprint5_steps.js
 *
 * Usage: node tests/step_defs/run-sprint5.js
 */

const path = require('path');
const { runFeatures } = require('./runner');

const steps = require('./sprint5_steps');
const featurePath = path.join(__dirname, '..', 'features');

(async () => {
  // 跑全部 features 但只关心 sprint5
  const allFeatures = require('fs').readdirSync(featurePath).filter(f => f.endsWith('.feature'));
  if (!allFeatures.includes('sprint5_mermaid_apply_fix.feature')) {
    console.error('Sprint 5 feature file not found');
    process.exit(1);
  }
  // 直接指定单 feature 文件路径
  const { parseFeature, StepRegistry } = require('./runner');
  const fs = require('fs');
  const content = fs.readFileSync(path.join(featurePath, 'sprint5_mermaid_apply_fix.feature'), 'utf-8');
  const scenarios = parseFeature(content);
  let passed = 0, failed = 0;
  for (const scenario of scenarios) {
    process.stdout.write(`  ${scenario.name} ... `);
    const ctx = {};
    try {
      for (const step of scenario.steps) {
        await steps.runStep(step.text, ctx);
      }
      console.log('✅ PASS');
      passed++;
    } catch (e) {
      console.log('❌ FAIL');
      console.log(`    ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${scenarios.length} total`);
  if (failed > 0) process.exit(1);
})();
