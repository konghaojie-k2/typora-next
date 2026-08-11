/**
 * BDD Acceptance Test Runner
 * Runs specific feature files against REAL filesystem + REAL frontend modules
 */

const fs = require('fs');
const path = require('path');
const { parseFeature, StepRegistry } = require('../shared/runner');

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
  const sprint4FeaturesDir = path.join(__dirname, '../sprint4/features');
  const sprint4Steps = require('./sprint4_review.steps');
  const sprint4Result = await runFeatureFile(
    path.join(sprint4FeaturesDir, 'sprint4_review_system.feature'),
    sprint4Steps
  );
  totalPassed += sprint4Result.passed;
  totalFailed += sprint4Result.failed;
  if (sprint4Steps._cleanup) sprint4Steps._cleanup.call({});

  // Sprint 5: Mermaid Fix Apply (AI 修复持久化)
  console.log(`\n${YELLOW}▶ Sprint 5: Mermaid Fix Apply${RESET}`);
  const sprint5FeaturesDir = path.join(__dirname, '../sprint5/features');
  const sprint5Steps = require('./sprint5_mermaid_apply_fix.steps');
  const sprint5Result = await runFeatureFile(
    path.join(sprint5FeaturesDir, 'sprint5_mermaid_apply_fix.feature'),
    sprint5Steps
  );
  totalPassed += sprint5Result.passed;
  totalFailed += sprint5Result.failed;
  if (sprint5Steps._cleanup) sprint5Steps._cleanup.call({});

  // Sprint 6: Explain Conversation (AI 解释 + 追问)
  console.log(`\n${YELLOW}▶ Sprint 6: Explain Conversation${RESET}`);
  const sprint6FeaturesDir = path.join(__dirname, '../sprint6/features');
  const sprint6Steps = require('./sprint6_explain_conversation.steps');
  const sprint6Result = await runFeatureFile(
    path.join(sprint6FeaturesDir, 'sprint6_explain_conversation.feature'),
    sprint6Steps
  );
  totalPassed += sprint6Result.passed;
  totalFailed += sprint6Result.failed;

  // Sprint 8: Socratic Review (V2 Notebook, 8a MVP: 核心状态 + 触发 + 集群 + 存档, LLM 留 8b)
  console.log(`\n${YELLOW}▶ Sprint 8: Socratic Review (8a MVP)${RESET}`);
  const sprint8FeaturesDir = path.join(__dirname, '../sprint8/features');
  const sprint8Steps = require('./sprint8_socratic_review.steps');
  const sprint8Result = await runFeatureFile(
    path.join(sprint8FeaturesDir, 'sprint8_socratic_review.feature'),
    sprint8Steps
  );
  totalPassed += sprint8Result.passed;
  totalFailed += sprint8Result.failed;
  if (sprint8Steps._cleanup) sprint8Steps._cleanup.call({});

  // Sprint 10: Paper Reader Workspace
  console.log(`\n${YELLOW}▶ Sprint 10: Paper Reader Workspace${RESET}`);
  const sprint10FeaturesDir = path.join(__dirname, '../sprint10/features');
  const sprint10Steps = require('./sprint10_paper_reader.steps');

  const pb1Result = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'pb1_paper_reader_open.feature'),
    sprint10Steps
  );
  totalPassed += pb1Result.passed;
  totalFailed += pb1Result.failed;

  const pb2Result = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'pb2_paper_reader_navigation.feature'),
    sprint10Steps
  );
  totalPassed += pb2Result.passed;
  totalFailed += pb2Result.failed;

  const pb3Result = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'pb3_paper_reader_feedback.feature'),
    sprint10Steps
  );
  totalPassed += pb3Result.passed;
  totalFailed += pb3Result.failed;

  const pb4Result = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'pb4_paper_reader_state_machine.feature'),
    sprint10Steps
  );
  totalPassed += pb4Result.passed;
  totalFailed += pb4Result.failed;

  const paperImportSteps = require('./sprint10_paper_import.steps');
  const pb5Result = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'paper_import.feature'),
    paperImportSteps
  );
  totalPassed += pb5Result.passed;
  totalFailed += pb5Result.failed;

  // Sprint 10: Toolbar tooltip quick reveal (UX improvement)
  console.log(`\n${YELLOW}▶ Sprint 10: Toolbar Tooltip Quick Reveal${RESET}`);
  const toolbarTooltipSteps = require('./sprint10_toolbar_tooltip.steps');
  const toolbarTooltipResult = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'toolbar_tooltip.feature'),
    toolbarTooltipSteps
  );
  totalPassed += toolbarTooltipResult.passed;
  totalFailed += toolbarTooltipResult.failed;

  // Sprint 10: Onboarding guide for first-time users
  console.log(`\n${YELLOW}▶ Sprint 10: First-time Onboarding Guide${RESET}`);
  const onboardingSteps = require('./sprint10_onboarding.steps');
  const onboardingResult = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'onboarding.feature'),
    onboardingSteps
  );
  totalPassed += onboardingResult.passed;
  totalFailed += onboardingResult.failed;

  // Issue #2: Agent SDK startup guidance
  console.log(`\n${YELLOW}▶ Issue #2: Agent SDK Startup Guidance${RESET}`);
  const agentSdkGuidanceSteps = require('./sprint10_agent_sdk_guidance.steps');
  const agentSdkGuidanceResult = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'agent_sdk_guidance.feature'),
    agentSdkGuidanceSteps
  );
  totalPassed += agentSdkGuidanceResult.passed;
  totalFailed += agentSdkGuidanceResult.failed;

  // Slides auto-split (design 2026-07-26)
  console.log(`\n${YELLOW}▶ Slides Auto-Split${RESET}`);
  const slidesAutoSplitSteps = require('./sprint10_slides_auto_split.steps');
  const slidesAutoSplitResult = await runFeatureFile(
    path.join(sprint10FeaturesDir, 'slides_auto_split.feature'),
    slidesAutoSplitSteps
  );
  totalPassed += slidesAutoSplitResult.passed;
  totalFailed += slidesAutoSplitResult.failed;

  // Sprint 11: Toolbar export menu consolidation
  console.log(`\n${YELLOW}▶ Sprint 11: Toolbar Export Menu Consolidation${RESET}`);
  const toolbarExportMenuSteps = require('./sprint11_toolbar_export_menu.steps');
  const toolbarExportMenuResult = await runFeatureFile(
    path.join(__dirname, '../sprint11/features/toolbar_export_menu.feature'),
    toolbarExportMenuSteps
  );
  totalPassed += toolbarExportMenuResult.passed;
  totalFailed += toolbarExportMenuResult.failed;

  // Sprint 12: Cornell text marks (划词痕迹)
  console.log(`\n${YELLOW}▶ Sprint 12: Cornell Text Marks${RESET}`);
  const cornellTextMarksSteps = require('./sprint12_cornell_text_marks.steps');
  const cornellTextMarksResult = await runFeatureFile(
    path.join(__dirname, '../sprint12/features/cornell_text_marks.feature'),
    cornellTextMarksSteps
  );
  totalPassed += cornellTextMarksResult.passed;
  totalFailed += cornellTextMarksResult.failed;

  // Sprint 13: SDK install progress visualization (pi-install-progress)
  console.log(`\n${YELLOW}▶ Sprint 13: SDK Install Progress${RESET}`);
  const sdkInstallProgressSteps = require('./sprint13_sdk_install_progress.steps');
  const sdkInstallProgressResult = await runFeatureFile(
    path.join(__dirname, '../sprint13/features/sdk_install_progress.feature'),
    sdkInstallProgressSteps
  );
  totalPassed += sdkInstallProgressResult.passed;
  totalFailed += sdkInstallProgressResult.failed;

  // Sprint 13: Quiz option shuffle (quiz-distractor-quality B 层)
  console.log(`\n${YELLOW}▶ Sprint 13: Quiz Option Shuffle${RESET}`);
  const quizShuffleSteps = require('./sprint13_quiz_shuffle.steps');
  const quizShuffleResult = await runFeatureFile(
    path.join(__dirname, '../sprint13/features/quiz_shuffle.feature'),
    quizShuffleSteps
  );
  totalPassed += quizShuffleResult.passed;
  totalFailed += quizShuffleResult.failed;

  // Sprint 14: External file refresh (background-tab detection + manual entry)
  console.log(`\n${YELLOW}▶ Sprint 14: External File Refresh${RESET}`);
  const externalRefreshSteps = require('./sprint14_external_refresh.steps');
  const externalRefreshResult = await runFeatureFile(
    path.join(__dirname, '../sprint14/features/external_refresh.feature'),
    externalRefreshSteps
  );
  totalPassed += externalRefreshResult.passed;
  totalFailed += externalRefreshResult.failed;

  // Sprint 15: Course completion slide summary (AI-generated theme recap)
  console.log(`\n${YELLOW}▶ Sprint 15: Course Completion Slide Summary${RESET}`);
  const courseSummarySteps = require('./sprint15_course_summary.steps');
  const courseSummaryResult = await runFeatureFile(
    path.join(__dirname, '../sprint15/features/course_completion_summary.feature'),
    courseSummarySteps
  );
  totalPassed += courseSummaryResult.passed;
  totalFailed += courseSummaryResult.failed;
  if (courseSummarySteps._cleanup) courseSummarySteps._cleanup.call({});

  // Sprint 16: Course completion state (terminal status + review entry de-nag)
  console.log(`\n${YELLOW}▶ Sprint 16: Course Completion State${RESET}`);
  const courseCompletionSteps = require('./sprint16_course_completion_state.steps');
  const courseCompletionResult = await runFeatureFile(
    path.join(__dirname, '../sprint16/features/course_completion_state.feature'),
    courseCompletionSteps
  );
  totalPassed += courseCompletionResult.passed;
  totalFailed += courseCompletionResult.failed;
  if (courseCompletionSteps._cleanup) courseCompletionSteps._cleanup.call({});

  // Sprint 16: Explain raw-quote truncation fix (skill constraint + parser wiring)
  console.log(`\n${YELLOW}▶ Sprint 16: Explain Raw-Quote Parsing Fix${RESET}`);
  const explainRawQuoteSteps = require('./sprint16_explain_raw_quote.steps');
  const explainRawQuoteResult = await runFeatureFile(
    path.join(__dirname, '../sprint16/features/explain_raw_quote_parsing.feature'),
    explainRawQuoteSteps
  );
  totalPassed += explainRawQuoteResult.passed;
  totalFailed += explainRawQuoteResult.failed;

  if (sprint10Steps._cleanup) sprint10Steps._cleanup.call({});
  if (paperImportSteps._cleanup) paperImportSteps._cleanup.call({});
  if (toolbarTooltipSteps._cleanup) toolbarTooltipSteps._cleanup.call({});
  if (onboardingSteps._cleanup) onboardingSteps._cleanup.call({});

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
