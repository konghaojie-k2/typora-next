#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Unified Test Runner — Sprint-based auto-discovery
 *
 * Usage:
 *   node tests/run-all.js                    # Run ALL tests (unit + integration + bdd + acceptance)
 *   node tests/run-all.js --unit             # Only unit tests
 *   node tests/run-all.js --integration      # Only integration tests
 *   node tests/run-all.js --bdd              # Only BDD tests (in-memory step defs)
 *   node tests/run-all.js --acceptance       # Only BDD acceptance tests (real filesystem)
 *   node tests/run-all.js --sprint=1         # Only Sprint 1 (all types)
 *   node tests/run-all.js --sprint=2 --unit  # Sprint 2 unit tests only
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const args = process.argv.slice(2);
const sprintFilter = args.find(a => a.startsWith('--sprint='));
const targetSprint = sprintFilter ? parseInt(sprintFilter.split('=')[1]) : null;
const hasTypeFlag = args.includes('--unit') || args.includes('--integration') || args.includes('--bdd') || args.includes('--acceptance');
const runAll = !hasTypeFlag;
const runUnit = runAll || args.includes('--unit');
const runIntegration = runAll || args.includes('--integration');
const runBDD = runAll || args.includes('--bdd');
const runAcceptance = runAll || args.includes('--acceptance');

let totalPassed = 0;
let totalFailed = 0;

const TESTS_ROOT = path.join(__dirname);

/**
 * Auto-discover tests for a given sprint
 */
function discoverSprint(sprintNum) {
  const base = path.join(TESTS_ROOT, `sprint${sprintNum}`);
  if (!fs.existsSync(base)) return null;

  const sprint = {
    id: sprintNum,
    name: `Sprint ${sprintNum}`,
    unitTests: [],
    integrationTests: [],
    hasBDD: false,
  };

  // Discover unit tests
  const unitDir = path.join(base, 'unit');
  if (fs.existsSync(unitDir)) {
    sprint.unitTests = fs.readdirSync(unitDir)
      .filter(f => f.startsWith('test_') && f.endsWith('.js'))
      .map(f => path.join(unitDir, f));
  }

  // Discover integration tests
  const integrationDir = path.join(base, 'integration');
  if (fs.existsSync(integrationDir)) {
    sprint.integrationTests = fs.readdirSync(integrationDir)
      .filter(f => f.startsWith('test_') && f.endsWith('.js'))
      .map(f => path.join(integrationDir, f));
  }

  // Discover BDD tests
  const featureDir = path.join(base, 'features');
  const stepsFile = path.join(base, 'steps', 'steps.js');
  if (fs.existsSync(featureDir) && fs.existsSync(stepsFile)) {
    sprint.featureDir = featureDir;
    sprint.stepsFile = stepsFile;
    sprint.hasBDD = true;
  }

  return sprint;
}

function runTestSuite(name, testFile) {
  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  ${name}${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}\n`);

  try {
    const output = execSync(`node "${testFile}"`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });
    console.log(output);

    const match = output.match(/(\d+)\s+passed,?\s*(\d+)\s+failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    return true;
  } catch (e) {
    console.log(e.stdout || e.message);
    const match = (e.stdout || '').match(/(\d+)\s+passed,?\s*(\d+)\s+failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    return false;
  }
}

async function runBDDForSprint(sprint) {
  if (!sprint.hasBDD) {
    console.log(`\n${YELLOW}  ⏭️  ${sprint.name} — BDD steps not found${RESET}`);
    return;
  }

  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  BDD: ${sprint.name}${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}\n`);

  const { runFeatures } = require('./shared/runner');
  const sprintSteps = require(sprint.stepsFile);

  const result = await runFeatures(sprint.featureDir, sprintSteps);
  totalPassed += result.passed;
  totalFailed += result.failed;
}

async function runAcceptanceTests() {
  const acceptanceRunner = path.join(TESTS_ROOT, 'bdd-acceptance', 'runner.js');
  if (!fs.existsSync(acceptanceRunner)) {
    console.log(`\n${YELLOW}  ⏭️  BDD Acceptance runner not found${RESET}`);
    return;
  }

  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  BDD Acceptance Tests${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}\n`);

  try {
    const output = execSync(`node "${acceptanceRunner}"`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000,
    });
    console.log(output);

    const match = output.match(/(\d+)\s+passed.*?\s*(\d+)\s+failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
  } catch (e) {
    console.log(e.stdout || e.message);
    const match = (e.stdout || '').match(/(\d+)\s+passed.*?\s*(\d+)\s+failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
  }
}

async function main() {
  console.log(`${YELLOW}🧪 Typora Next — Unified Test Suite${RESET}`);
  console.log(`${YELLOW}Working directory: ${process.cwd()}${RESET}`);
  if (targetSprint) {
    console.log(`${YELLOW}Filter: Sprint ${targetSprint}${RESET}`);
  }
  if (hasTypeFlag) {
    const types = [];
    if (args.includes('--unit')) types.push('unit');
    if (args.includes('--integration')) types.push('integration');
    if (args.includes('--bdd')) types.push('bdd');
    if (args.includes('--acceptance')) types.push('acceptance');
    console.log(`${YELLOW}Filter: ${types.join(', ')} only${RESET}`);
  }

  // Discover sprints dynamically
  const sprints = [];
  const entries = fs.readdirSync(TESTS_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('sprint')) {
      const sprintNum = parseInt(entry.name.replace('sprint', ''), 10);
      if (!isNaN(sprintNum)) {
        const sprint = discoverSprint(sprintNum);
        if (sprint && (
          sprint.unitTests.length > 0 ||
          sprint.integrationTests.length > 0 ||
          sprint.hasBDD
        )) {
          sprints.push(sprint);
        }
      }
    }
  }
  sprints.sort((a, b) => a.id - b.id);

  const sprintsToRun = targetSprint
    ? sprints.filter(s => s.id === targetSprint)
    : sprints;

  if (sprintsToRun.length === 0) {
    console.log(`${RED}No sprints found matching filter${RESET}`);
    process.exit(1);
  }

  for (const sprint of sprintsToRun) {
    // Unit tests
    if (runUnit) {
      for (const testFile of sprint.unitTests) {
        const testName = path.basename(testFile, '.js');
        runTestSuite(`Unit [Sprint ${sprint.id}]: ${testName}`, testFile);
      }
    }

    // Integration tests
    if (runIntegration) {
      for (const testFile of sprint.integrationTests) {
        const testName = path.basename(testFile, '.js');
        runTestSuite(`Integration [Sprint ${sprint.id}]: ${testName}`, testFile);
      }
    }

    // BDD tests
    if (runBDD) {
      await runBDDForSprint(sprint);
    }
  }

  // Acceptance tests (run once, not per-sprint)
  if (runAcceptance && !targetSprint) {
    await runAcceptanceTests();
  }

  // Summary
  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  TEST SUMMARY${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${GREEN}  ✅ Passed: ${totalPassed}${RESET}`);
  console.log(`${RED}  ❌ Failed: ${totalFailed}${RESET}`);
  console.log(`${CYAN}  📊 Total:  ${totalPassed + totalFailed}${RESET}`);

  if (totalFailed > 0) {
    console.log(`\n${RED}  Tests failed!${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}  All tests passed! 🎉${RESET}\n`);
  }
}

main().catch(e => {
  console.error(`${RED}Test runner error: ${e.message}${RESET}`);
  process.exit(1);
});
