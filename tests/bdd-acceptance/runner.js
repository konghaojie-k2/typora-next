/**
 * BDD Acceptance Test Runner
 * Runs specific feature files against REAL filesystem + REAL frontend modules
 */

const fs = require('fs');
const path = require('path');
const { parseFeature, StepRegistry } = require('../step_defs/runner');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Run a single feature file with given step definitions
 */
async function runFeatureFile(featurePath, stepDefs, label) {
  const content = fs.readFileSync(featurePath, 'utf-8');
  const scenarios = parseFeature(content);
  let passed = 0;
  let failed = 0;

  console.log(`\n${YELLOW}Feature: ${path.basename(featurePath)}${RESET}`);

  for (const scenario of scenarios) {
    process.stdout.write(`  ${scenario.name} ... `);

    const context = {}; // Fresh context for each scenario
    try {
      for (const step of scenario.steps) {
        await stepDefs.runStep(step.text, context);
      }
      console.log(`${GREEN}✅ PASS${RESET}`);
      passed++;
    } catch (e) {
      console.log(`${RED}❌ FAIL${RESET}`);
      console.log(`    ${RED}  ${e.message}${RESET}`);
      failed++;
    }
  }

  return { passed, failed };
}

async function runAcceptanceTests() {
  console.log(`${CYAN}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}║     BDD Acceptance Tests — Real Filesystem Layer           ║${RESET}`);
  console.log(`${CYAN}╚════════════════════════════════════════════════════════════╝${RESET}\n`);

  let totalPassed = 0;
  let totalFailed = 0;

  const featuresDir = path.join(__dirname, '../sprint2/features');

  // Sprint 2: Learning Hub
  console.log(`${YELLOW}▶ Sprint 2: Learning Hub${RESET}`);
  const hubSteps = require('./sprint2_learning_hub.steps');
  const hubResult = await runFeatureFile(
    path.join(featuresDir, 'sprint2_learning_hub.feature'),
    hubSteps
  );
  totalPassed += hubResult.passed;
  totalFailed += hubResult.failed;
  if (hubSteps._cleanup) hubSteps._cleanup.call({});

  // Sprint 2: Resume Project
  console.log(`\n${YELLOW}▶ Sprint 2: Resume Project${RESET}`);
  const resumeSteps = require('./sprint2_resume_project.steps');
  const resumeResult = await runFeatureFile(
    path.join(featuresDir, 'sprint2_resume_project.feature'),
    resumeSteps
  );
  totalPassed += resumeResult.passed;
  totalFailed += resumeResult.failed;
  if (resumeSteps._cleanup) resumeSteps._cleanup.call({});

  // Sprint 3: Learning Elements & Quiz
  console.log(`\n${YELLOW}▶ Sprint 3: Learning Elements & Quiz${RESET}`);
  const sprint3FeaturesDir = path.join(__dirname, '../sprint3/features');
  const sprint3Steps = require('./sprint3_learning_elements.steps');
  const sprint3Result = await runFeatureFile(
    path.join(sprint3FeaturesDir, 'sprint3_learning_mode.feature'),
    sprint3Steps
  );
  totalPassed += sprint3Result.passed;
  totalFailed += sprint3Result.failed;
  if (sprint3Steps._cleanup) sprint3Steps._cleanup.call({});

  // Sprint 4: Review System (遗忘曲线复习)
  console.log(`\n${YELLOW}▶ Sprint 4: Review System${RESET}`);
  const sprint4FeaturesDir = path.join(__dirname, '../features');
  const sprint4Steps = require('./sprint4_review.steps');
  const sprint4Result = await runFeatureFile(
    path.join(sprint4FeaturesDir, 'sprint4_review_system.feature'),
    sprint4Steps
  );
  totalPassed += sprint4Result.passed;
  totalFailed += sprint4Result.failed;
  if (sprint4Steps._cleanup) sprint4Steps._cleanup.call({});

  // Summary
  console.log(`\n${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${GREEN}${totalPassed} passed${RESET}, ${RED}${totalFailed} failed${RESET}, ${totalPassed + totalFailed} total`);
  console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  if (totalFailed > 0) {
    console.log(`${RED}❌ ACCEPTANCE FAILED${RESET} — 真实环境验证未通过`);
    process.exit(1);
  } else {
    console.log(`${GREEN}✅ ACCEPTANCE PASSED${RESET} — 真实文件系统验证通过`);
  }
}

runAcceptanceTests().catch(err => {
  console.error(`${RED}Runner error:${RESET}`, err);
  process.exit(1);
});
