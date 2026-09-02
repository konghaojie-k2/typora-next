Feature: 跨课程记忆（结课档案 + 全局索引 + plan 注入）

  As a learner who finished a beginner course
  I want the next course's outline to skip concepts I already mastered
  and to include bridging review chapters for my weak concepts
  So that courses chain together instead of restarting from zero

  行为层（档案聚合 / 截断 / 去重 / backfill / prompt 注入与 None 回归）由
  Rust test（learner_profile_test 14 个、plan_prompt_test 14 个）覆盖；
  本 feature 验收全链路接线：结课钩子、命令注册、prompt 段落、创建对话框提示行。

  # PB21-1: 数据层

  Scenario: learner_profile 纯模块实现档案与聚合
    Given the real learner_profile source
    Then it should expose build_completion_profile
    And it should expose record_course_completion
    And it should expose aggregate_learner_context
    And it should expose learner_index_path and list_valid_course_names
    And aggregation should truncate to newest five courses
    And aggregation should dedup concepts with newest status winning

  # PB21-2: 结课钩子与命令

  Scenario: 课程完结时生成档案并登记全局索引
    Given the real lib.rs source
    Then persist_quiz_result should record completion profile on course completion
    And the hook should be best-effort with non-fatal logging
    And backfill_completion_profile command should be registered
    And list_learner_courses command should be registered

  # PB21-3: plan 注入

  Scenario: build_plan_prompt 注入学习者历史
    Given the real plan_prompt source
    Then build_plan_prompt should accept learner_context parameter
    And the prompt should contain 学习者历史 section and 衔接规则
    And None context should leave the prompt without the learner section

  Scenario: 规划调用链聚合记忆后注入
    Given the real ai_agent.rs source
    Then plan flow should aggregate learner context before building the prompt

  # PB21-4: 前端 UX

  Scenario: 创建课程对话框显示记忆提示行
    Given the real index.html and project-manager.js sources
    Then the create dialog should contain the learnerContextHint element
    And project-manager should load learner courses on dialog open
    And the hint should be hidden when there are no completed courses

  Scenario: 存量完结课程打开时自动 backfill
    Given the real project-resume.js source
    Then completed course load should invoke backfill_completion_profile
    And the backfill call should be best-effort
