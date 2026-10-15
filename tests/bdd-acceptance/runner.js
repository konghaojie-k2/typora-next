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

  // Sprint 15 (course-completion slide summary) was REMOVED in Sprint 22 —
  // feature deleted by user decision (quality bar not met; replaced by the
  // course roadmap feature). Its steps/feature/unit tests are gone.

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

  // Sprint 17: Course case study (notebook shell + case-study stage + session persistence)
  console.log(`\n${YELLOW}▶ Sprint 17: Course Case Study${RESET}`);
  const caseStudySteps = require('./sprint17_case_study.steps');
  const caseStudyResult = await runFeatureFile(
    path.join(__dirname, '../sprint17/features/case_study.feature'),
    caseStudySteps
  );
  totalPassed += caseStudyResult.passed;
  totalFailed += caseStudyResult.failed;
  if (caseStudySteps._cleanup) caseStudySteps._cleanup.call({});

  // Sprint 19: Course-type adaptive chapter template (humanities/technical branches)
  console.log(`\n${YELLOW}▶ Sprint 19: Course-Type Adaptive Chapters${RESET}`);
  const courseTypeSteps = require('./sprint19_course_type.steps');
  const courseTypeResult = await runFeatureFile(
    path.join(__dirname, '../sprint19/features/sprint19_course_type.feature'),
    courseTypeSteps
  );
  totalPassed += courseTypeResult.passed;
  totalFailed += courseTypeResult.failed;
  if (courseTypeSteps._cleanup) courseTypeSteps._cleanup.call({});

  // Sprint 20: 课程内容元素约束 (engineering 域 + D 层硬校验)
  console.log(`\n${YELLOW}▶ Sprint 20: Element Constraint (engineering + D-layer)${RESET}`);
  const elementSteps = require('./sprint20_element_constraint.steps');
  const elementResult = await runFeatureFile(
    path.join(__dirname, '../sprint20/features/sprint20_element_constraint.feature'),
    elementSteps
  );
  totalPassed += elementResult.passed;
  totalFailed += elementResult.failed;
  if (elementSteps._cleanup) elementSteps._cleanup.call({});

  // Sprint 21: 跨课程记忆（结课档案 + 全局索引 + plan 注入）
  console.log(`\n${YELLOW}▶ Sprint 21: Cross-Course Memory (profile + index + plan injection)${RESET}`);
  const memorySteps = require('./sprint21_cross_course_memory.steps');
  const memoryResult = await runFeatureFile(
    path.join(__dirname, '../sprint21/features/sprint21_cross_course_memory.feature'),
    memorySteps
  );
  totalPassed += memoryResult.passed;
  totalFailed += memoryResult.failed;
  if (memorySteps._cleanup) memorySteps._cleanup.call({});

  // Sprint 22: 结课 roadmap（📍 下一站）+ 课程总结删除反向断言
  console.log(`\n${YELLOW}▶ Sprint 22: Course Roadmap + Summary Deletion${RESET}`);
  const roadmapSteps = require('./sprint22_course_roadmap.steps');
  const roadmapResult = await runFeatureFile(
    path.join(__dirname, '../sprint22/features/sprint22_course_roadmap.feature'),
    roadmapSteps
  );
  totalPassed += roadmapResult.passed;
  totalFailed += roadmapResult.failed;

  // Sprint 23: 学习者画像 v1（领域组合 + 类比素材）
  console.log(`\n${YELLOW}▶ Sprint 23: Learner Persona (domains + analogy bank)${RESET}`);
  const personaSteps = require('./sprint23_learner_persona.steps');
  const personaResult = await runFeatureFile(
    path.join(__dirname, '../sprint23/features/sprint23_learner_persona.feature'),
    personaSteps
  );
  totalPassed += personaResult.passed;
  totalFailed += personaResult.failed;

  // Sprint 24: 内联 SVG 插图（engineering/humanities 内容增强 + E 层校验）
  console.log(`\n${YELLOW}▶ Sprint 24: Inline SVG figures (engineering/humanities + E-layer gate)${RESET}`);
  const svgSteps = require('./sprint24_inline_svg.steps');
  const svgResult = await runFeatureFile(
    path.join(__dirname, '../sprint24/features/sprint24_inline_svg.feature'),
    svgSteps
  );
  totalPassed += svgResult.passed;
  totalFailed += svgResult.failed;

  // Sprint 25: LaTeX 兼容层（KaTeX 裸上下标 sanitize）
  console.log(`\n${YELLOW}▶ Sprint 25: LaTeX compat sanitize (bare sup/sub after spacing)${RESET}`);
  const latexSteps = require('./sprint25_latex_compat.steps');
  const latexResult = await runFeatureFile(
    path.join(__dirname, '../sprint25/features/sprint25_latex_compat.feature'),
    latexSteps
  );
  totalPassed += latexResult.passed;
  totalFailed += latexResult.failed;

  // Sprint 26: 人文课原作试听嵌入（Wikimedia Commons 内联播放器）
  console.log(`\n${YELLOW}▶ Sprint 26: Humanities media embed (Wikimedia Commons audio)${RESET}`);
  const mediaSteps = require('./sprint26_media_embed.steps');
  const mediaResult = await runFeatureFile(
    path.join(__dirname, '../sprint26/features/sprint26_media_embed.feature'),
    mediaSteps
  );
  totalPassed += mediaResult.passed;
  totalFailed += mediaResult.failed;

  // Sprint 27: 更新进度可见性 + 代理感知（issue #6）
  const updateProgressSteps = require('./sprint27_update_progress.steps');
  const updateProgressResult = await runFeatureFile(
    path.join(__dirname, '../sprint27/features/sprint27_update_progress.feature'),
    updateProgressSteps
  );
  totalPassed += updateProgressResult.passed;
  totalFailed += updateProgressResult.failed;

  // Sprint 29 PB1: 按领域搜索论文（AnySearch）
  console.log(`\n${YELLOW}▶ Sprint 29: Paper Search (AnySearch)${RESET}`);
  const paperSearchSteps = require('./sprint29_paper_search.steps');
  const paperSearchResult = await runFeatureFile(
    path.join(__dirname, '../sprint29/features/sprint29_paper_search.feature'),
    paperSearchSteps
  );
  totalPassed += paperSearchResult.passed;
  totalFailed += paperSearchResult.failed;

  // Sprint 29 PB2: 设置面板分组 + 保存合并（不丢 UI 状态）
  console.log(`\n${YELLOW}▶ Sprint 29: Settings Panel regroup + save-merge${RESET}`);
  const settingsPanelSteps = require('./sprint29_settings_panel.steps');
  const settingsPanelResult = await runFeatureFile(
    path.join(__dirname, '../sprint29/features/sprint29_settings_panel.feature'),
    settingsPanelSteps
  );
  totalPassed += settingsPanelResult.passed;
  totalFailed += settingsPanelResult.failed;

  // Sprint 30: 论文库首页 + 缓存交互修复
  console.log(`\n${YELLOW}▶ Sprint 30: Paper Library home + cache UX${RESET}`);
  const paperLibrarySteps = require('./sprint30_paper_library.steps');
  const paperLibraryResult = await runFeatureFile(
    path.join(__dirname, '../sprint30/features/sprint30_paper_library.feature'),
    paperLibrarySteps
  );
  totalPassed += paperLibraryResult.passed;
  totalFailed += paperLibraryResult.failed;

  // Sprint 30b: 导入时选择领域
  console.log(`\n${YELLOW}▶ Sprint 30b: Domain picker at import${RESET}`);
  const domainPickerSteps = require('./sprint30_domain_picker.steps');
  const domainPickerResult = await runFeatureFile(
    path.join(__dirname, '../sprint30/features/sprint30_domain_picker.feature'),
    domainPickerSteps
  );
  totalPassed += domainPickerResult.passed;
  totalFailed += domainPickerResult.failed;

  // Sprint 30c: 论文库真删除（文件+索引）
  console.log(`\n${YELLOW}▶ Sprint 30c: Paper library real delete${RESET}`);
  const paperDeleteSteps = require('./sprint30_paper_delete.steps');
  const paperDeleteResult = await runFeatureFile(
    path.join(__dirname, '../sprint30/features/sprint30_paper_delete.feature'),
    paperDeleteSteps
  );
  totalPassed += paperDeleteResult.passed;
  totalFailed += paperDeleteResult.failed;

  // Sprint 31: 导入失败批量 agent 补救
  console.log(`\n${YELLOW}▶ Sprint 31: Paper Rescue (batch agent)${RESET}`);
  const paperRescueSteps = require('./sprint31_paper_rescue.steps');
  const paperRescueResult = await runFeatureFile(
    path.join(__dirname, '../sprint31/features/sprint31_paper_rescue.feature'),
    paperRescueSteps
  );
  totalPassed += paperRescueResult.passed;
  totalFailed += paperRescueResult.failed;

  // Sprint 32: 安装期 Windows Shell 契约（快捷方式图标 + ICO 编码）
  console.log(`\n${YELLOW}▶ Sprint 32: Installer shell contract${RESET}`);
  const installerShellSteps = require('./sprint32_installer_shell_contract.steps');
  const installerShellResult = await runFeatureFile(
    path.join(__dirname, '../sprint32/features/sprint32_installer_shell_contract.feature'),
    installerShellSteps
  );
  totalPassed += installerShellResult.passed;
  totalFailed += installerShellResult.failed;

  // 课程分享：内容打包 + 应用内导入（不含学习上下文）
  console.log(`\n${YELLOW}▶ Course Share (content-only zip)${RESET}`);
  const courseShareSteps = require('./course_share.steps');
  const courseShareResult = await runFeatureFile(
    path.join(__dirname, '../course-share/features/course_share.feature'),
    courseShareSteps
  );
  totalPassed += courseShareResult.passed;
  totalFailed += courseShareResult.failed;
  if (courseShareSteps._cleanup) courseShareSteps._cleanup.call({});

  // 划线批注 UX：就近输入 + 备注标志 + hover 可读（源码契约断言）
  console.log(`\n${YELLOW}▶ Annotation Notes UX${RESET}`);
  const annotationNotesSteps = require('./annotation_notes.steps');
  const annotationNotesResult = await runFeatureFile(
    path.join(__dirname, '../annotation-notes/features/annotation_notes.feature'),
    annotationNotesSteps
  );
  totalPassed += annotationNotesResult.passed;
  totalFailed += annotationNotesResult.failed;

  // AI 伴学统一入口：解释 / 举例 / 我有话说（单一入口 + own-voice 链路）
  console.log(`\n${YELLOW}▶ AI Companion (unified entry)${RESET}`);
  const aiCompanionSteps = require('./ai_companion.steps');
  const aiCompanionResult = await runFeatureFile(
    path.join(__dirname, '../ai-companion/features/ai_companion.feature'),
    aiCompanionSteps
  );
  totalPassed += aiCompanionResult.passed;
  totalFailed += aiCompanionResult.failed;
  if (aiCompanionSteps._cleanup) aiCompanionSteps._cleanup.call({});

  // LLM 状态感知与故障分级（断流事故容灾，见 docs/plans/2026-10-14-llm-provider-failover-design.md）
  console.log(`\n${YELLOW}▶ LLM Resilience (status surfacing + error classification)${RESET}`);
  const llmResilienceSteps = require('./llm_resilience.steps');
  const llmResilienceResult = await runFeatureFile(
    path.join(__dirname, '../llm-resilience/features/llm_resilience.feature'),
    llmResilienceSteps
  );
  totalPassed += llmResilienceResult.passed;
  totalFailed += llmResilienceResult.failed;

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
