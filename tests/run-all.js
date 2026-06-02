/**
 * Unified Test Runner (Sprint-based)
 *
 * Usage:
 *   node tests/run-all.js              # Run ALL sprints
 *   node tests/run-all.js --sprint=1   # Only Sprint 1
 *   node tests/run-all.js --sprint=2   # Only Sprint 2
 *   node tests/run-all.js --unit       # Only unit tests (all sprints)
 *   node tests/run-all.js --bdd        # Only BDD tests (all sprints)
 *   node tests/run-all.js --sprint=2 --bdd  # Sprint 2 BDD only
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
const hasTypeFlag = args.includes('--unit') || args.includes('--integration') || args.includes('--bdd');
const runAll = !hasTypeFlag; // No type flag = run all types
const runUnit = runAll || args.includes('--unit');
const runIntegration = runAll || args.includes('--integration');
const runBDD = runAll || args.includes('--bdd');

let totalPassed = 0;
let totalFailed = 0;

// Sprint configurations
const SPRINTS = [
  {
    id: 1,
    name: 'Sprint 1: 学习项目骨架',
    unitTests: [
      'tests/sprint1/unit/test_agent_bridge.js',
      'tests/sprint1/unit/test_project_manager.js',
      'tests/sprint1/unit/test_project_manager_impl.js',
    ],
    integrationTests: [
      'tests/sprint1/integration/test_agent_bridge.js',
    ],
    featureDir: 'tests/sprint1/features',
    stepsFile: 'tests/sprint1/steps/steps.js',
  },
  {
    id: 2,
    name: 'Sprint 2: 逐章生成 + 后台预生成',
    unitTests: [
      'tests/sprint2/unit/test_progress_tracker.js',
      'tests/sprint2/unit/test_learning_renderer.js',
      'tests/sprint2/unit/test_project_folder.js',
    ],
    integrationTests: [],
    featureDir: 'tests/sprint2/features',
    stepsFile: 'tests/sprint2/steps/steps.js',
  },
  {
    id: 3,
    name: 'Sprint 3: 学习模式渲染 + 测验',
    unitTests: [],
    integrationTests: [],
    featureDir: 'tests/sprint3/features',
    stepsFile: null, // Not implemented yet
  },
  {
    id: 4,
    name: 'Sprint 4: 进度追踪 + 知识图谱 + 遗忘曲线',
    unitTests: [],
    integrationTests: [],
    featureDir: 'tests/sprint4/features',
    stepsFile: null, // Not implemented yet
  },
];

function runTestSuite(name, command, cwd) {
  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  ${name}${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}\n`);

  try {
    const output = execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    console.log(output);

    const match = output.match(/(\d+) passed, (\d+) failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    return true;
  } catch (e) {
    console.log(e.stdout || e.message);
    const match = (e.stdout || '').match(/(\d+) passed, (\d+) failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    return false;
  }
}

async function runBDDForSprint(sprint) {
  if (!sprint.stepsFile) {
    console.log(`\n${YELLOW}  ⏭️  ${sprint.name} - BDD steps not implemented yet${RESET}`);
    return;
  }

  console.log(`\n${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  BDD: ${sprint.name}${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════${RESET}\n`);

  const { runFeatures } = require('./shared/runner');
  const sprintSteps = require(path.join(__dirname, '..', sprint.stepsFile));

  const result = await runFeatures(path.join(__dirname, '..', sprint.featureDir), sprintSteps);
  totalPassed += result.passed;
  totalFailed += result.failed;
}

async function main() {
  console.log(`${YELLOW}🧪 AI Learning Designer - Test Suite${RESET}`);
  console.log(`${YELLOW}Working directory: ${process.cwd()}${RESET}`);
  if (targetSprint) {
    console.log(`${YELLOW}Filter: Sprint ${targetSprint}${RESET}`);
  }

  const sprintsToRun = targetSprint
    ? SPRINTS.filter(s => s.id === targetSprint)
    : SPRINTS;

  for (const sprint of sprintsToRun) {
    // Unit tests
    if (runUnit) {
      for (const testFile of sprint.unitTests) {
        const testName = path.basename(testFile, '.js');
        runTestSuite(
          `Unit [Sprint ${sprint.id}]: ${testName}`,
          `node ${testFile}`
        );
      }
    }

    // Integration tests
    if (runIntegration) {
      for (const testFile of sprint.integrationTests) {
        const testName = path.basename(testFile, '.js');
        runTestSuite(
          `Integration [Sprint ${sprint.id}]: ${testName}`,
          `node ${testFile}`
        );
      }
    }

    // BDD tests
    if (runBDD) {
      await runBDDForSprint(sprint);
    }
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
