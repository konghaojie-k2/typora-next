Feature: 课程类型自适应章节模板（Course-Type Adaptive Chapters）

  As a learner taking a humanities course (music appreciation, art history)
  I want chapters without filler pseudocode and with form-matched visuals
  So that the material fits the subject instead of a technical template

  行为层由 Rust plan_prompt / skills_bundle 模块覆盖
  （cargo test --test plan_prompt_test --test skills_bundle_test）；
  本 feature 验收 skill 内容约束与全链路接线。

  Scenario: chapter-generation skill 定义了课程类型判定与类型分支
    Given the bundled chapter-generation skill
    Then SKILL.md should have a course-type decision section
    And SKILL.md should define all three course types
    And SKILL.md should forbid filler pseudocode for humanities
    And SKILL.md should require concrete work examples for humanities
    And SKILL.md should contain a mermaid type-selection guide

  Scenario: MUST-VERIFY checklist 按类型分化
    Given the bundled chapter-generation skill
    Then the checklist should have a universal block
    And the checklist should have per-type conditional items

  Scenario: content-format.md 同步课程类型分支
    Given the chapter-generation content-format spec
    Then the spec should be version 1.2
    And the spec should parameterize math and code rules

  Scenario: 类型全链路接线（Rust 规划 → 持久化 → prompt 注入）
    Given the real ai_agent.rs and lib.rs sources
    Then build_plan_prompt should request course_type
    And create_learning_project should persist course_type
    And generate_chapters should inject course_type into bridge args

  Scenario: bridge prompt 按类型注入且无 session 时 inline 参考资料
    Given the real agent-bridge.mjs source
    Then buildChapterPrompt should emit course_type conditionally
    And fresh sessions should get skill refs inlined

  Scenario: 技能拷贝递归使 references/ 落地
    Given the real ai_agent.rs and lib.rs sources
    Then the skills copy should be recursive

  Scenario: examples.md 含人文课镜像片段
    Given the chapter-generation examples reference
    Then examples should be labeled as a technical-course example
    And examples should include a humanities fragment with timeline
