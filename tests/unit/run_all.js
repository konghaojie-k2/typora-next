#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Run all unit tests in tests/unit/
 * Each test file runs in an isolated Node process so process.exit()
 * in one file does not kill the runner.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function runOne(label, filePath) {
  console.log(`▶ ${label}`);
  const result = spawnSync('node', [filePath], {
    cwd: __dirname,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  // Print stdout (strip trailing newline to avoid double blank lines)
  if (result.stdout) {
    process.stdout.write(result.stdout.replace(/\n+$/, '\n'));
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  // Parse summary line: "X passed, Y failed, Z total"
  const summaryMatch = (result.stdout || '').match(/(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+total/);
  if (summaryMatch) {
    return {
      passed: parseInt(summaryMatch[1], 10),
      failed: parseInt(summaryMatch[2], 10),
      total: parseInt(summaryMatch[3], 10),
      ok: result.status === 0
    };
  }

  // Fallback: if exit code is 0, assume all passed; otherwise mark as failed
  return {
    passed: result.status === 0 ? 1 : 0,
    failed: result.status === 0 ? 0 : 1,
    total: 1,
    ok: result.status === 0
  };
}

async function runAll() {
  console.log('═════════════════════════════════════════');
  console.log('  Unit Tests — All');
  console.log('═════════════════════════════════════════\n');

  // Discover all test_*.js files in this directory
  const files = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('test_') && f.endsWith('.js'))
    .sort();

  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  let anyFailed = false;

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    const result = runOne(file, filePath);
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalTests += result.total;
    if (!result.ok) anyFailed = true;
  }

  console.log('═════════════════════════════════════════');
  console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed, ${totalTests} total`);
  console.log('═════════════════════════════════════════');

  process.exit(anyFailed ? 1 : 0);
}

runAll().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
